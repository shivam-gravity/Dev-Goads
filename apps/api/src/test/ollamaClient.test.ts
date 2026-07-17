import { test } from "node:test";
import assert from "node:assert";

// Same fetch-capture-at-construction issue as llmRouter.test.ts: the OpenAI SDK (which
// ollamaClient.ts reuses against Ollama's OpenAI-compatible endpoint) captures `fetch` once
// when the client is constructed, so the mock must be installed before the dynamic import
// below via a stable indirection that each test can swap the target of.
let currentFetchImpl: typeof fetch = (async () => {
  throw new Error("no fetch impl installed for this test");
}) as typeof fetch;
global.fetch = ((...args: Parameters<typeof fetch>) => currentFetchImpl(...args)) as typeof fetch;

const { runStructured, runText } = await import("../infra/ollamaClient.js");

// The Content-Type header is what makes the OpenAI SDK parse a mocked body as JSON instead
// of returning it as a raw string — see llmRouter.test.ts for the bug this was discovered
// fixing. Every mocked response here sets it explicitly.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

test("ollamaClient.runStructured - hits the configured Ollama baseURL with the requested model and forced tool_choice, returns parsed args", async () => {
  let capturedUrl: string | undefined;
  let capturedBody: any;
  currentFetchImpl = (async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String((init as RequestInit).body));
    return jsonResponse({
      choices: [{ message: { tool_calls: [{ type: "function", function: { name: "emit_test", arguments: JSON.stringify({ ok: true }) } }] } }],
    });
  }) as typeof fetch;

  const result = await runStructured<{ ok: boolean }>({ ...BASE_OPTS, model: "llama3.1:8b" });

  assert.ok(capturedUrl?.includes("11434"), `expected the Ollama baseURL, got: ${capturedUrl}`);
  assert.strictEqual(capturedBody.model, "llama3.1:8b");
  assert.deepStrictEqual(capturedBody.tool_choice, { type: "function", function: { name: "emit_test" } });
  assert.deepStrictEqual(result, { ok: true });
});

test("ollamaClient.runStructured - no tool call in the response resolves to null", async () => {
  currentFetchImpl = (async () => jsonResponse({ choices: [{ message: { tool_calls: [] } }] })) as typeof fetch;

  const result = await runStructured(BASE_OPTS);
  assert.strictEqual(result, null);
});

test("ollamaClient.runText - returns the assistant's plain text content", async () => {
  currentFetchImpl = (async () => jsonResponse({ choices: [{ message: { content: "hello from ollama" } }] })) as typeof fetch;

  const result = await runText({ maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
  assert.strictEqual(result, "hello from ollama");
});

test("ollamaClient.runStructured - caps concurrent requests at OLLAMA_MAX_CONCURRENT (default 2), later callers queue rather than running simultaneously", async () => {
  let active = 0;
  let peakActive = 0;
  currentFetchImpl = (async () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return jsonResponse({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "emit_test", arguments: "{}" } }] } }] });
  }) as typeof fetch;

  await Promise.all(Array.from({ length: 5 }, () => runStructured(BASE_OPTS)));

  assert.ok(peakActive <= 2, `expected at most 2 concurrent Ollama requests, saw ${peakActive}`);
});
