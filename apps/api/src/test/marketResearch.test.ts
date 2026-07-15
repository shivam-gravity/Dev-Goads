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

test("Market research - runWebResearch always returns an empty result, even with GROQ_API_KEY configured, since no provider offers hosted web search", async () => {
  // OpenAI's gpt-4o-search-preview was the only hosted-search backend this platform ever
  // had (removed along with the rest of OpenAI — see infra/llmClient.ts's doc comment).
  // llmClient.ts's runWebSearch is now a permanent no-op regardless of which LLM provider
  // is configured — this is the durable contract, not a "missing key" degrade. A fresh
  // cache-busted import is required: llmClient.ts's `llm` gate is computed once at
  // module-evaluation time, so setting GROQ_API_KEY after the file-top import above
  // wouldn't change what that already-loaded module saw.
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not be called — runWebSearch never makes a network call now");
  }) as typeof fetch;
  process.env.GROQ_API_KEY = "test-groq-key";

  try {
    const { runWebResearch: runWebResearchWithGroq } = await import(`../modules/onboarding/marketResearch.js?t=${Date.now()}`);
    const result = await runWebResearchWithGroq("What is the pricing for a different, uncached business?");
    assert.deepStrictEqual(result, { narrative: "", citations: [], searchesUsed: 0 });
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = original;
    delete process.env.GROQ_API_KEY;
  }
});
