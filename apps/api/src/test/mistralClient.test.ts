import { test } from "node:test";
import assert from "node:assert";

delete process.env.MISTRAL_API_KEY;

global.fetch = (async (url: unknown) => {
  throw new Error(`mistralClient must not make any network call when unconfigured: ${String(url)}`);
}) as typeof fetch;

const { runStructured, runText, createEmbedding, isMistralConfigured } = await import("../infra/mistralClient.js");

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

test("mistralClient.runStructured - no MISTRAL_API_KEY returns null without any network call", async () => {
  const result = await runStructured(BASE_OPTS);
  assert.strictEqual(result, null);
});

test("mistralClient.runText - no MISTRAL_API_KEY returns null without any network call", async () => {
  const result = await runText({ maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
  assert.strictEqual(result, null);
});

test("mistralClient.createEmbedding - no MISTRAL_API_KEY returns null without any network call", async () => {
  const result = await createEmbedding("some text");
  assert.strictEqual(result, null);
});

test("mistralClient.isMistralConfigured - false without MISTRAL_API_KEY", () => {
  assert.strictEqual(isMistralConfigured(), false);
});
