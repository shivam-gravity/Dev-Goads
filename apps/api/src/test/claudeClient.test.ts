import { test } from "node:test";
import assert from "node:assert";

// Deliberately do NOT set ANTHROPIC_API_KEY — this file exercises exactly the "not
// configured" path, which is what every environment without a real Claude key (the
// common case today) actually hits. The "configured, call succeeds/fails" paths are
// covered indirectly by llmRouter.test.ts's fallback tests and, for a real key, the live
// smoke test — not duplicated here with a fake key, since claudeClient.ts's own gate is
// just `process.env.ANTHROPIC_API_KEY ? new Anthropic() : null`, nothing left to mock.
delete process.env.ANTHROPIC_API_KEY;

global.fetch = (async (url: unknown) => {
  throw new Error(`claudeClient must not make any network call when unconfigured: ${String(url)}`);
}) as typeof fetch;

const { runStructured, runText } = await import("../infra/claudeClient.js");

const TOOL = { name: "emit_test", description: "test tool", input_schema: { type: "object" as const, properties: {} } };
const BASE_OPTS = { maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }], tool: TOOL };

test("claudeClient.runStructured - no ANTHROPIC_API_KEY returns null without any network call", async () => {
  const result = await runStructured(BASE_OPTS);
  assert.strictEqual(result, null);
});

test("claudeClient.runText - no ANTHROPIC_API_KEY returns null without any network call", async () => {
  const result = await runText({ maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
  assert.strictEqual(result, null);
});
