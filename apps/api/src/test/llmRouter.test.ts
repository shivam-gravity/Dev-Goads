import { test } from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { getGlobalLlmMonthlyBudget } from "../infra/llmUsageBoundary.js";

// Set before any import touches groqClient.ts/mistralClient.ts (module-load-time env
// reads, same cache-busting-avoidance convention as scrapeFallback.test.ts) — lets these
// tests exercise the "configured, but the call itself fails" fallback path for the
// non-Groq providers, rather than only their "not configured at all" degrade path
// (which is covered separately in mistralClient.test.ts/geminiClient.test.ts).
process.env.GROQ_API_KEY = "test-groq-key";
process.env.MISTRAL_API_KEY = "test-mistral-key";
// Redirects the global usage ledger to a throwaway path — without this, a real
// (persistent, file-based) global-usage-exceeded state left over from an earlier run
// would make this file's "an groq assignment calls Groq directly" style assertions fail
// nondeterministically depending on what state happens to be on disk.
process.env.LLM_USAGE_LEDGER_PATH = path.join(os.tmpdir(), "test-llm-usage-llmRouter.json");

// Regression guard for the ledger-isolation fix: a test run must NOT use the production 5M/month
// cap (llmUsageBoundary.ts detects the test runner and uses an effectively-unlimited budget + a
// temp ledger), so the suite's own real LLM calls can never exhaust the real monthly budget and
// break every subsequent LLM-backed test — which is exactly what happened once.
test("llmUsageBoundary - a test run uses an effectively-unlimited budget, isolating the real monthly cap", () => {
  assert.ok(getGlobalLlmMonthlyBudget() > 5_000_000, "test run must not use the production 5M token cap");
});

// The Groq/Ollama SDKs (both use the OpenAI SDK pointed at a different baseURL) capture
// `fetch` once at client-construction time (`this.fetch = options.fetch ?? Shims.getDefaultFetch()`),
// not on every call — so reassigning `global.fetch` inside each test would have zero
// effect on the module-level client singletons constructed the moment llmRouter.js (and
// its transitive groqClient.ts/ollamaClient.ts) is imported below. Installing a stable
// indirection *before* that import means the SDKs capture this wrapper once, and each
// test only needs to swap what it delegates to. mistralClient.ts uses plain fetch() per
// call (no SDK), so it isn't affected by this constraint either way, but the same
// indirection works for it unchanged.
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

function groqToolResponse(): Response {
  return jsonResponse({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "emit_test", arguments: JSON.stringify({ ok: true, via: "groq" }) } }] } }] });
}

test("llmRouter.runStructured - a groq assignment calls Groq directly, no fallback wrapping", async () => {
  const original = currentFetchImpl;
  let calls = 0;
  currentFetchImpl = (async (url) => {
    calls += 1;
    if (isUrl(url, "api.groq.com")) return groqToolResponse();
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "groq", model: "llama-3.3-70b-versatile" }, BASE_OPTS);
    assert.strictEqual(result.source, "groq");
    assert.deepStrictEqual(result.data, { ok: true, via: "groq" });
    assert.strictEqual(calls, 1);
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - an ollama assignment succeeding never calls Groq", async () => {
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

test("llmRouter.runStructured - an ollama assignment failing falls back to a succeeding Groq call", async () => {
  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "11434")) throw new Error("ollama unreachable (simulated)");
    if (isUrl(url, "api.groq.com")) return groqToolResponse();
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "ollama", model: "llama3.1" }, BASE_OPTS);
    assert.strictEqual(result.source, "groq");
    assert.deepStrictEqual(result.data, { ok: true, via: "groq" });
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - a mistral assignment with no real key configured falls back to Groq without ever reaching Mistral's API", async () => {
  // Simulates the "no real MISTRAL_API_KEY" case indirectly: mistralClient.ts's own gate
  // already returns null without a network call when unconfigured, which is exercised
  // directly in mistralClient.test.ts. Here we confirm the *router's* fallback still works
  // when the assigned client returns null for any reason (here: a tool-call-less response).
  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "api.mistral.ai")) {
      return jsonResponse({ choices: [{ message: {} }] }); // no tool_calls => null
    }
    if (isUrl(url, "api.groq.com")) return groqToolResponse();
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "mistral", model: "mistral-small-latest" }, BASE_OPTS);
    assert.strictEqual(result.source, "groq");
    assert.deepStrictEqual(result.data, { ok: true, via: "groq" });
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - a groq assignment failing now falls back to Mistral instead of failing outright", async () => {
  // The actual production bug this fallback chain exists to fix: Groq is the default
  // assignment for most tasks, and until this chain existed, a Groq failure (e.g. its
  // daily token quota exhausted) had no further fallback at all — every task defaulted to
  // Groq degraded to "no live research" simultaneously. Mistral is the next tier now.
  const original = currentFetchImpl;
  const reached: string[] = [];
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "api.groq.com")) {
      reached.push("groq");
      throw new Error("429 rate limit (simulated)");
    }
    if (isUrl(url, "api.mistral.ai")) {
      reached.push("mistral");
      return jsonResponse({ choices: [{ message: { tool_calls: [{ function: { name: "emit_test", arguments: JSON.stringify({ ok: true, via: "mistral" }) } }] } }] });
    }
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "groq", model: "llama-3.3-70b-versatile" }, BASE_OPTS);
    assert.strictEqual(result.source, "mistral");
    assert.deepStrictEqual(result.data, { ok: true, via: "mistral" });
    // The OpenAI SDK (which groqClient.ts reuses) auto-retries a connection error a few
    // times before giving up, so groq may appear more than once — dedup to first-seen
    // order to assert only what matters: groq was tried, then mistral, in that order.
    assert.deepStrictEqual([...new Set(reached)], ["groq", "mistral"]);
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - the assigned provider, Groq, and Mistral all failing still degrades gracefully, never throws", async () => {
  const original = currentFetchImpl;
  const reached: string[] = [];
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "11434")) reached.push("ollama");
    else if (isUrl(url, "api.groq.com")) reached.push("groq");
    else if (isUrl(url, "api.mistral.ai")) reached.push("mistral");
    throw new Error("network unavailable (simulated)");
  }) as typeof fetch;

  try {
    const result = await runStructured({ provider: "ollama", model: "llama3.1" }, BASE_OPTS);
    assert.strictEqual(result.data, null);
    // Reports the originally-assigned provider once the whole chain is exhausted — no
    // single leg is privileged as "the" source when everything failed.
    assert.strictEqual(result.source, "ollama");
    // Confirms the chain actually walked through every configured tier (not just
    // "didn't throw") — Google/Gemini isn't in this list since GEMINI_API_KEY isn't set in
    // this test file, so it degrades to null without a network call, same as being absent.
    // Dedup to first-seen order: the OpenAI SDK (groq/ollama) auto-retries a connection
    // error a few times before giving up, so a provider may appear more than once.
    assert.deepStrictEqual([...new Set(reached)], ["ollama", "mistral", "groq"]);
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
    throw new Error(`must not reach Groq when fallback is disabled: ${String(url)}`);
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
  delete process.env.MISTRAL_API_KEY;
});
