import { test } from "node:test";
import assert from "node:assert";

// openRouterClient.ts constructs its OpenAI-SDK client (pointed at openrouter.ai) at module
// load, reading OPENROUTER_API_KEY once — so the key must be set BEFORE the dynamic import
// below, and the fetch mock installed via a stable indirection the SDK captures once (same
// constraint as ollamaClient.test.ts / llmRouter.test.ts).
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

let currentFetchImpl: typeof fetch = (async () => {
  throw new Error("no fetch impl installed for this test");
}) as typeof fetch;
global.fetch = ((...args: Parameters<typeof fetch>) => currentFetchImpl(...args)) as typeof fetch;

const { runStructured, runText, isOpenRouterConfigured } = await import("../infra/openRouterClient.js");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

test("openRouterClient.isOpenRouterConfigured - true when OPENROUTER_API_KEY is set", () => {
  assert.strictEqual(isOpenRouterConfigured(), true);
});

test("openRouterClient.runStructured - hits openrouter.ai with the configured model + forced tool_choice, returns parsed args", async () => {
  let capturedUrl: string | undefined;
  let capturedBody: any;
  currentFetchImpl = (async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String((init as RequestInit).body));
    return jsonResponse({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "emit_test", arguments: JSON.stringify({ ok: true }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  }) as typeof fetch;

  const result = await runStructured<{ ok: boolean }>(BASE_OPTS);

  assert.ok(capturedUrl?.includes("openrouter.ai"), `expected the OpenRouter baseURL, got: ${capturedUrl}`);
  assert.strictEqual(capturedBody.model, "meta-llama/llama-3.3-70b-instruct:free");
  assert.deepStrictEqual(capturedBody.tool_choice, { type: "function", function: { name: "emit_test" } });
  assert.deepStrictEqual(result, { ok: true });
});

test("openRouterClient.runStructured - no tool call in the response resolves to null", async () => {
  currentFetchImpl = (async () => jsonResponse({ choices: [{ message: { tool_calls: [] } }], usage: {} })) as typeof fetch;
  const result = await runStructured(BASE_OPTS);
  assert.strictEqual(result, null);
});

test("openRouterClient.runText - returns the assistant's plain text content", async () => {
  currentFetchImpl = (async () => jsonResponse({ choices: [{ message: { content: "hello from openrouter" } }], usage: {} })) as typeof fetch;
  const result = await runText({ maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
  assert.strictEqual(result, "hello from openrouter");
});

test("openRouterClient.runStructured - caps concurrent requests (default 3) so a fan-out burst can't stampede the free-tier pool", async () => {
  let active = 0;
  let peakActive = 0;
  currentFetchImpl = (async () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return jsonResponse({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "emit_test", arguments: "{}" } }] } }], usage: {} });
  }) as typeof fetch;

  await Promise.all(Array.from({ length: 8 }, () => runStructured(BASE_OPTS)));

  assert.ok(peakActive <= 3, `expected at most 3 concurrent OpenRouter requests, saw ${peakActive}`);
});

test.after(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
});
