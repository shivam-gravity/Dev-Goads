import { test } from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { getGlobalLlmMonthlyBudget } from "../infra/llmUsageBoundary.js";

// Set before any import touches bedrockClient.ts (module-load-time env reads, same
// cache-busting-avoidance convention as scrapeFallback.test.ts) — lets these tests exercise the
// "configured, but the call itself fails" path rather than only the "not configured at all"
// degrade path (covered separately in bedrockClient.test.ts).
process.env.AWS_BEARER_TOKEN_BEDROCK = "test-bedrock-key";
// Redirects the global usage ledger to a throwaway path — without this, a real (persistent,
// file-based) global-usage-exceeded state left over from an earlier run would make these
// assertions fail nondeterministically depending on what state happens to be on disk.
process.env.LLM_USAGE_LEDGER_PATH = path.join(os.tmpdir(), "test-llm-usage-llmRouter.json");

// Regression guard for the ledger-isolation fix: a test run must NOT use the production 5M/month
// cap (llmUsageBoundary.ts detects the test runner and uses an effectively-unlimited budget + a
// temp ledger), so the suite's own real LLM calls can never exhaust the real monthly budget and
// break every subsequent LLM-backed test — which is exactly what happened once.
test("llmUsageBoundary - a test run uses an effectively-unlimited budget, isolating the real monthly cap", () => {
  assert.ok(getGlobalLlmMonthlyBudget() > 5_000_000, "test run must not use the production 5M token cap");
});

// bedrockClient.ts uses plain fetch() per call (no SDK that captures fetch at construction), so a
// stable indirection installed before importing the router lets each test swap the delegate.
let currentFetchImpl: typeof fetch = (async () => {
  throw new Error("no fetch impl installed for this test");
}) as typeof fetch;
global.fetch = ((...args: Parameters<typeof fetch>) => currentFetchImpl(...args)) as typeof fetch;

const { runStructured, runText } = await import("../infra/llmRouter.js");

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };
const BEDROCK = { provider: "bedrock" as const, model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0" };

function isUrl(url: string | URL | Request, needle: string): boolean {
  return String(url instanceof Request ? url.url : url).includes(needle);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Bedrock Converse forced-tool-use shape: content block carries `toolUse.input` (already-parsed).
function bedrockToolResponse(input: unknown): Response {
  return jsonResponse({ output: { message: { content: [{ toolUse: { name: "emit_test", input } }] } }, usage: { inputTokens: 1, outputTokens: 1 } });
}

test("llmRouter.runStructured - a bedrock assignment calls Bedrock and returns the parsed tool input", async () => {
  const original = currentFetchImpl;
  let calls = 0;
  currentFetchImpl = (async (url) => {
    calls += 1;
    if (isUrl(url, "bedrock-runtime")) return bedrockToolResponse({ ok: true, via: "bedrock" });
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured(BEDROCK, BASE_OPTS);
    assert.strictEqual(result.source, "bedrock");
    assert.deepStrictEqual(result.data, { ok: true, via: "bedrock" });
    assert.strictEqual(calls, 1);
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runText - a bedrock assignment returns the concatenated text", async () => {
  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "bedrock-runtime")) {
      return jsonResponse({ output: { message: { content: [{ text: "hello " }, { text: "world" }] } }, usage: { inputTokens: 1, outputTokens: 2 } });
    }
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runText(BEDROCK, { maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
    assert.strictEqual(result.source, "bedrock");
    assert.strictEqual(result.data, "hello world");
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - a Bedrock failure degrades to null (source still bedrock), never throws", async () => {
  const original = currentFetchImpl;
  currentFetchImpl = (async () => {
    throw new Error("network unavailable (simulated)");
  }) as typeof fetch;

  try {
    const result = await runStructured(BEDROCK, BASE_OPTS);
    assert.strictEqual(result.data, null);
    assert.strictEqual(result.source, "bedrock");
  } finally {
    currentFetchImpl = original;
  }
});

test("llmRouter.runStructured - a non-retryable Bedrock 4xx degrades to null instead of throwing", async () => {
  const original = currentFetchImpl;
  currentFetchImpl = (async (url) => {
    if (isUrl(url, "bedrock-runtime")) return new Response("bad request", { status: 400, headers: { "content-type": "text/plain" } });
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runStructured(BEDROCK, BASE_OPTS);
    assert.strictEqual(result.data, null);
    assert.strictEqual(result.source, "bedrock");
  } finally {
    currentFetchImpl = original;
  }
});

test.after(() => {
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
});
