import { test } from "node:test";
import assert from "node:assert";

delete process.env.OPENAI_API_KEY;

const { runWebResearch } = await import(`../modules/onboarding/marketResearch.js?t=${Date.now()}`);

test("Market research - runWebResearch falls back to an empty result with no API key, no network call", async () => {
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  }) as typeof fetch;

  try {
    const result = await runWebResearch("What is the pricing for Acme Corp?");
    assert.deepStrictEqual(result, { narrative: "", citations: [], searchesUsed: 0 });
    assert.strictEqual(fetchCalled, false, "no OPENAI_API_KEY should mean zero network calls — the core cost-control guarantee");
  } finally {
    global.fetch = original;
  }
});
