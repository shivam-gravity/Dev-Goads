import { test } from "node:test";
import assert from "node:assert";

// Deliberately do NOT set GEMINI_API_KEY — even though a real one now exists in
// apps/api/.env, this test file never loads dotenv (no "dotenv/config" import, and nothing
// this module transitively imports does either), so process.env.GEMINI_API_KEY stays unset
// here regardless of what's in .env. This exercises the "not configured" path that every
// environment without dotenv-loaded env vars actually hits; the "configured, real call"
// path is covered by the live smoke test using the real key instead.
delete process.env.GEMINI_API_KEY;

global.fetch = (async (url: unknown) => {
  throw new Error(`geminiClient must not make any network call when unconfigured: ${String(url)}`);
}) as typeof fetch;

const { runStructured, runText } = await import("../infra/geminiClient.js");

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

test("geminiClient.runStructured - no GEMINI_API_KEY returns null without any network call", async () => {
  const result = await runStructured(BASE_OPTS);
  assert.strictEqual(result, null);
});

test("geminiClient.runText - no GEMINI_API_KEY returns null without any network call", async () => {
  const result = await runText({ maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
  assert.strictEqual(result, null);
});
