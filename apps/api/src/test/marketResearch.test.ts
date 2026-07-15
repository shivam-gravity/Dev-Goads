import { test, after } from "node:test";
import assert from "node:assert";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

delete process.env.OPENAI_API_KEY;
delete process.env.FIRECRAWL_API_KEY;
delete process.env.TAVILY_API_KEY;
delete process.env.SERPER_API_KEY;
delete process.env.SEARXNG_BASE_URL;
// llmClient.ts's `llm` gate (isGroqConfigured()) is a frozen module-scope const, evaluated
// once at whichever import first triggers it — unlike the 3 search vendors' key checks
// below, which read process.env fresh on every call. Setting this BEFORE the one-and-only
// import of marketResearch.js in this file is the only point where that freeze can still
// be influenced; a later cache-busted re-import of marketResearch.js would still resolve
// its own (non-busted) `from "../../infra/llmClient.js"` import to this same already-cached
// instance, so setting it any later would have no effect.
process.env.GROQ_API_KEY = "test-groq-key";

const { runWebResearch } = await import(`../modules/onboarding/marketResearch.js?t=${Date.now()}`);

test("Market research - runWebResearch falls back to an empty result with no search vendor configured, no network call", async () => {
  // tavilyClient.ts/serperClient.ts/searxngClient.ts all read their keys fresh on every
  // call (not frozen module-scope consts), so deleting them above guarantees each one
  // short-circuits to "no-key" before ever calling fetch — regardless of whichever earlier
  // test file in this shared process already cached them with real keys frozen in.
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  }) as typeof fetch;

  try {
    const result = await runWebResearch("What is the pricing for Acme Corp?");
    assert.deepStrictEqual(result, { narrative: "", citations: [], searchesUsed: 0 });
    assert.strictEqual(fetchCalled, false, "no search vendor configured should mean zero network calls — the core cost-control guarantee");
  } finally {
    global.fetch = original;
  }
});

test("Market research - runWebResearch performs a real Tavily search and converts results into a narrative + citations, when TAVILY_API_KEY is configured", async () => {
  // Tavily backs runWebSearch's default "web-research" task assignment (infra/llmClient.ts
  // -> infra/searchRouter.ts -> infra/searchTaskConfig.ts) — replacing Firecrawl's /search,
  // which replaced OpenAI's hosted search before it, each swap made after the prior
  // vendor's account hit a real limit. `llm` is already true (GROQ_API_KEY was set before
  // this file's one import, above) — only Tavily's own, freshly-read key check needs
  // setting here.
  const original = global.fetch;
  process.env.TAVILY_API_KEY = "test-tavily-key";
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("api.tavily.com/search")) {
      return new Response(
        JSON.stringify({ results: [{ title: "Acme Corp Pricing Guide", url: "https://example.com/acme-pricing", content: "Acme Corp charges $99/mo for its starter plan." }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await runWebResearch("What is the pricing for a different, uncached business XYZ123?");
    assert.match(result.narrative, /Acme Corp charges \$99\/mo/);
    assert.deepStrictEqual(result.citations, [{ url: "https://example.com/acme-pricing", title: "Acme Corp Pricing Guide" }]);
    assert.strictEqual(result.searchesUsed, 1);
  } finally {
    global.fetch = original;
    delete process.env.TAVILY_API_KEY;
  }
});
