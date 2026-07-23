import { test } from "node:test";
import assert from "node:assert";
import os from "node:os";
import path from "node:path";

// bedrockClient.ts reads AWS_BEARER_TOKEN_BEDROCK / AWS_REGION / BEDROCK_* at module load, so the
// env must be set BEFORE the dynamic import below, and the fetch mock installed via a stable
// indirection captured before the module resolves (same constraint as the other client tests).
// Opt the global usage boundary out of the way for this unit test: it reads a persistent monthly
// token ledger, and a dev machine that has run real research this month can already be at/over the
// 5M default cap — which would make these MOCKED-fetch tests fail on assertGlobalLlmUsageAvailable
// before the mock is even hit. An explicit budget env wins over the default (see llmUsageBoundary.ts),
// and a dedicated temp ledger keeps this test from touching the real one. Both are read at module
// load, so they must be set before the dynamic import below.
process.env.LLM_MONTHLY_TOKEN_BUDGET = String(Number.MAX_SAFE_INTEGER);
process.env.LLM_USAGE_LEDGER_PATH = path.join(os.tmpdir(), "polluxa-bedrock-test-usage.json");
process.env.AWS_BEARER_TOKEN_BEDROCK = "test-bedrock-token";
process.env.AWS_REGION = "us-east-1";
process.env.BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
process.env.BEDROCK_MAX_CONCURRENCY = "3";
process.env.BEDROCK_MAX_RETRIES = "2";
process.env.BEDROCK_MAX_BACKOFF_MS = "10"; // keep the retry test fast

let currentFetchImpl: typeof fetch = (async () => {
  throw new Error("no fetch impl installed for this test");
}) as typeof fetch;
global.fetch = ((...args: Parameters<typeof fetch>) => currentFetchImpl(...args)) as typeof fetch;

const { runStructured, runText, isBedrockConfigured } = await import("../infra/bedrockClient.js");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// The Converse forced-tool response shape (verified live 2026-07-21): the tool call's `input` is
// an already-parsed object, NOT a JSON string.
function toolUseResponse(name: string, input: unknown): Response {
  return jsonResponse({
    output: { message: { role: "assistant", content: [{ toolUse: { name, input, toolUseId: "t1" } }] } },
    usage: { inputTokens: 10, outputTokens: 5 },
  });
}

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: { ok: { type: "boolean" } } } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

test("bedrockClient.isBedrockConfigured - true when AWS_BEARER_TOKEN_BEDROCK is set", () => {
  assert.strictEqual(isBedrockConfigured(), true);
});

test("bedrockClient.runStructured - hits the region Converse endpoint with forced toolChoice, returns the parsed tool input", async () => {
  let capturedUrl: string | undefined;
  let capturedBody: any;
  let capturedAuth: string | undefined;
  currentFetchImpl = (async (url, init) => {
    capturedUrl = String(url);
    capturedAuth = (init as RequestInit).headers ? (((init as RequestInit).headers as Record<string, string>).Authorization) : undefined;
    capturedBody = JSON.parse(String((init as RequestInit).body));
    return toolUseResponse("emit_test", { ok: true });
  }) as typeof fetch;

  const result = await runStructured<{ ok: boolean }>(BASE_OPTS);

  assert.ok(capturedUrl?.includes("bedrock-runtime.us-east-1.amazonaws.com"), `expected the Bedrock runtime host, got: ${capturedUrl}`);
  assert.ok(capturedUrl?.includes("/converse"), "must call the Converse endpoint");
  assert.strictEqual(capturedAuth, "Bearer test-bedrock-token", "must send the bearer token");
  // Forced tool-choice by name + tool spec carries the JSON schema under inputSchema.json.
  assert.deepStrictEqual(capturedBody.toolConfig.toolChoice, { tool: { name: "emit_test" } });
  assert.deepStrictEqual(capturedBody.toolConfig.tools[0].toolSpec.inputSchema.json, TOOL.input_schema);
  assert.deepStrictEqual(result, { ok: true });
});

test("bedrockClient.runStructured - a response with no toolUse block resolves to null", async () => {
  currentFetchImpl = (async () => jsonResponse({ output: { message: { role: "assistant", content: [{ text: "no tool here" }] } }, usage: {} })) as typeof fetch;
  const result = await runStructured(BASE_OPTS);
  assert.strictEqual(result, null);
});

test("bedrockClient.runText - concatenates the assistant text blocks", async () => {
  currentFetchImpl = (async () => jsonResponse({ output: { message: { role: "assistant", content: [{ text: "hello " }, { text: "from bedrock" }] } }, usage: { inputTokens: 1, outputTokens: 2 } })) as typeof fetch;
  const result = await runText({ maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
  assert.strictEqual(result, "hello from bedrock");
});

test("bedrockClient.runText - passes a system prompt as the top-level system array", async () => {
  let capturedBody: any;
  currentFetchImpl = (async (_url, init) => {
    capturedBody = JSON.parse(String((init as RequestInit).body));
    return jsonResponse({ output: { message: { content: [{ text: "ok" }] } }, usage: {} });
  }) as typeof fetch;
  await runText({ maxTokens: 50, system: "You are terse.", messages: [{ role: "user", content: "hi" }] });
  assert.deepStrictEqual(capturedBody.system, [{ text: "You are terse." }]);
});

test("bedrockClient.runStructured - retries a 429 (ThrottlingException) then succeeds", async () => {
  let calls = 0;
  currentFetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return new Response("throttled", { status: 429 });
    return toolUseResponse("emit_test", { ok: true });
  }) as typeof fetch;

  const result = await runStructured<{ ok: boolean }>(BASE_OPTS);
  assert.strictEqual(calls, 2, "should retry once after a 429");
  assert.deepStrictEqual(result, { ok: true });
});

test("bedrockClient.runStructured - caps concurrent requests (set to 3) so a fan-out burst can't stampede", async () => {
  let active = 0;
  let peakActive = 0;
  currentFetchImpl = (async () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return toolUseResponse("emit_test", { ok: true });
  }) as typeof fetch;

  await Promise.all(Array.from({ length: 8 }, () => runStructured(BASE_OPTS)));
  assert.ok(peakActive <= 3, `expected at most 3 concurrent Bedrock requests, saw ${peakActive}`);
});

test.after(() => {
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  delete process.env.AWS_REGION;
  delete process.env.BEDROCK_MODEL;
  delete process.env.BEDROCK_MAX_CONCURRENCY;
  delete process.env.BEDROCK_MAX_RETRIES;
  delete process.env.BEDROCK_MAX_BACKOFF_MS;
});
