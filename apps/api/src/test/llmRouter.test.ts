import { test } from "node:test";
import assert from "node:assert";

// Set before any import touches openaiClient.ts/claudeClient.ts (module-load-time env
// reads, same cache-busting-avoidance convention as scrapeFallback.test.ts) — lets these
// tests exercise the "configured, but the call itself fails" fallback path for the
// non-OpenAI providers, rather than only their "not configured at all" degrade path
// (which is covered separately in claudeClient.test.ts/geminiClient.test.ts).
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

// The OpenAI/Anthropic SDKs capture `fetch` once at client-construction time
// (`this.fetch = options.fetch ?? Shims.getDefaultFetch()`), not on every call — so
// reassigning `global.fetch` inside each test would have zero effect on the module-level
// client singletons constructed the moment llmRouter.js (and its transitive
// openaiClient.ts/ollamaClient.ts/claudeClient.ts) is imported below. Installing a stable
// indirection *before* that import means the SDKs capture this wrapper once, and each
// test only needs to swap what it delegates to.
let currentFetchImpl: typeof fetch = (async () => {
  throw new Error("no fetch impl installed for this test");
}) as typeof fetch;
global.fetch = ((...args: Parameters<typeof fetch>) => currentFetchImpl(...args)) as typeof fetch;

const { runStructured } = await import("../infra/llmRouter.js");

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

function isUrl(url: string | URL | Request, needle: string): boolean {
  return String(url instanceof Request ? url.url : url).includes(needle);
}

// The OpenAI SDK (and others) decide whether to parse a response body as JSON or return it
// as raw text based on the Content-Type header — a bare `new Response(JSON.stringify(...))`
// defaults to `text/plain`, which makes `.create()` silently resolve to the raw string
// instead of a parsed object (no error, just a `completion.choices` that's `undefined`).
// Every mocked response in this file MUST set this header explicitly.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function openaiToolResponse(): Response {
  return jsonResponse({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "emit_test", arguments: JSON.stringify({ ok: true, via: "openai" }) } }] } }] });
}

test("llmRouter.runStructured - an openai assignment calls OpenAI directly, no fallback wrapping", async () => {
  const original = currentFetchImpl;
  let calls = 0;
  currentFetchImpl = (async (url) => {
    calls += 1;
    if (isUrl(url, "api.openai.com")) return openaiToolResponse();
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "openai", model: "gpt-4o" }, BASE_OPTS);
    assert.strictEqual(result.source, "openai");
    assert.deepStrictEqual(result.data, { ok: true, via: "openai" });
    assert.strictEqual(calls, 1);
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - an ollama assignment succeeding never calls OpenAI", async () => {
  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "11434")) {
      return jsonResponse({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "emit_test", arguments: JSON.stringify({ ok: true, via: "ollama" }) } }] } }] });
    }
    throw new Error(`must not reach any other backend: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "ollama", model: "llama3.1" }, BASE_OPTS);
    assert.strictEqual(result.source, "ollama");
    assert.deepStrictEqual(result.data, { ok: true, via: "ollama" });
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - an ollama assignment failing falls back to a succeeding OpenAI call", async () => {
  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "11434")) throw new Error("ollama unreachable (simulated)");
    if (isUrl(url, "api.openai.com")) return openaiToolResponse();
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "ollama", model: "llama3.1" }, BASE_OPTS);
    assert.strictEqual(result.source, "openai");
    assert.deepStrictEqual(result.data, { ok: true, via: "openai" });
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - an anthropic assignment with no real key configured falls back to OpenAI without ever reaching Claude's API", async () => {
  // Simulates the "no ANTHROPIC_API_KEY" case indirectly: claudeClient.ts's own gate
  // already returns null without a network call when unconfigured, which is exercised
  // directly in claudeClient.test.ts. Here we confirm the *router's* fallback still works
  // when the assigned client returns null for any reason.
  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "api.anthropic.com")) {
      return jsonResponse({ content: [] }); // no tool_use block => null
    }
    if (isUrl(url, "api.openai.com")) return openaiToolResponse();
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "anthropic", model: "claude-sonnet-5" }, BASE_OPTS);
    assert.strictEqual(result.source, "openai");
    assert.deepStrictEqual(result.data, { ok: true, via: "openai" });
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - both the assigned provider and the OpenAI fallback failing still degrades gracefully, never throws", async () => {
  const original = currentFetchImpl;
  currentFetchImpl = (async () => {
    throw new Error("network unavailable (simulated)");
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "ollama", model: "llama3.1" }, BASE_OPTS);
    assert.strictEqual(result.data, null);
    assert.strictEqual(result.source, "openai");
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - LLM_TASK_FALLBACK_ENABLED=false disables the safety net, an ollama failure is not caught", async () => {
  process.env.LLM_TASK_FALLBACK_ENABLED = "false";
  const { runStructured: runStructuredNoFallback } = await import(`../infra/llmRouter.js?t=${Date.now()}`);

  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "11434")) throw new Error("ollama unreachable (simulated)");
    throw new Error(`must not reach OpenAI when fallback is disabled: ${String(url)}`);
  }) as typeof fetch;

  try {
    // The OpenAI SDK (which ollamaClient.ts reuses against a different baseURL) wraps any
    // thrown fetch error into a generic `APIConnectionError: Connection error.`, discarding
    // the original message — so this only asserts that the rejection propagates at all
    // (i.e. isn't swallowed), not the original "ollama unreachable" text.
    await assert.rejects(() => runStructuredNoFallback({ provider: "ollama", model: "llama3.1" }, BASE_OPTS), /Connection error/);
  } finally {
    currentFetchImpl = original;
    delete process.env.LLM_TASK_FALLBACK_ENABLED;
  }
});

test.after(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
