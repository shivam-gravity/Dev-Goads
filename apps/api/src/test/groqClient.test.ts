import { test } from "node:test";
import assert from "node:assert";

// Deliberately do NOT set GROQ_API_KEY — same reasoning as geminiClient.test.ts: this file
// never loads dotenv, so process.env.GROQ_API_KEY stays unset regardless of .env, exercising
// the "not configured" path.
delete process.env.GROQ_API_KEY;

global.fetch = (async (url: unknown) => {
  throw new Error(`groqClient must not make any network call when unconfigured: ${String(url)}`);
}) as typeof fetch;

const { runStructured, runText, isGroqConfigured } = await import("../infra/groqClient.js");

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

test("groqClient.runStructured - no GROQ_API_KEY returns null without any network call", async () => {
  const result = await runStructured(BASE_OPTS);
  assert.strictEqual(result, null);
});

test("groqClient.runText - no GROQ_API_KEY returns null without any network call", async () => {
  const result = await runText({ maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
  assert.strictEqual(result, null);
});

test("groqClient.isGroqConfigured - false without GROQ_API_KEY", () => {
  assert.strictEqual(isGroqConfigured(), false);
});
