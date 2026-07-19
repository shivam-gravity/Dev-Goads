import { test } from "node:test";
import assert from "node:assert";

// mistralClient reads MISTRAL_API_KEY + the retry/concurrency knobs once at module-load time,
// so set them BEFORE the import below (same cache-busting-avoidance convention as the rest of
// the suite). Tiny backoff so the retry tests run fast, not on the 500ms+ production schedule.
process.env.MISTRAL_API_KEY = "test-mistral-key";
process.env.MISTRAL_MAX_RETRIES = "3";
// The backoff wait honors a server "retry-after" header; the 429 mocks below send
// "retry-after: 0" so each retry waits ~0ms and these tests stay near-instant.

const { runStructured } = await import("../infra/mistralClient.js");

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

function toolResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "emit_test", arguments: JSON.stringify(payload) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function rateLimited(): Response {
  // retry-after: 0 keeps the test near-instant while still exercising the retry path.
  return new Response(JSON.stringify({ message: "rate limited" }), { status: 429, headers: { "retry-after": "0" } });
}

test("mistralClient - a 429 is retried with backoff and then succeeds (rate limit, not a hard failure)", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    if (calls < 3) return rateLimited(); // throttled twice, then OK
    return toolResponse({ ok: true, via: "mistral" });
  }) as typeof fetch;

  try {
    const result = await runStructured(BASE_OPTS);
    assert.deepStrictEqual(result, { ok: true, via: "mistral" });
    assert.strictEqual(calls, 3, "should have retried through the two 429s before succeeding");
  } finally {
    global.fetch = original;
  }
});

test("mistralClient - persistent 429s eventually throw after exhausting retries (not an infinite loop)", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return rateLimited();
  }) as typeof fetch;

  try {
    await assert.rejects(() => runStructured(BASE_OPTS), /429/);
    // MISTRAL_MAX_RETRIES=3 => 1 initial + 3 retries = 4 attempts total.
    assert.strictEqual(calls, 4, "should attempt exactly max-retries+1 times then give up");
  } finally {
    global.fetch = original;
  }
});

test("mistralClient - a non-retryable 401 throws immediately without burning retries", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await assert.rejects(() => runStructured(BASE_OPTS), /401/);
    assert.strictEqual(calls, 1, "a 401 is not a rate limit — must not retry");
  } finally {
    global.fetch = original;
  }
});

test.after(() => {
  delete process.env.MISTRAL_API_KEY;
  delete process.env.MISTRAL_MAX_RETRIES;
});
