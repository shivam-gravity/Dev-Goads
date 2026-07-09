import { test, after } from "node:test";
import assert from "node:assert";

// OpenAI's client captures `fetch` at construction time (`new OpenAI()`, which
// marketResearch.ts does at module load), so the mock must be installed BEFORE the
// dynamic import runs — same ordering constraint as metaAdapter.live.test.ts, just for
// module-load-time construction instead of a per-call fetch.
process.env.OPENAI_API_KEY = "test-key";

let fetchCallCount = 0;
const originalFetch = global.fetch;
global.fetch = (async (url: string) => {
  fetchCallCount++;
  assert.ok(String(url).includes("api.openai.com"));
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({
      id: "chatcmpl_test",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o-search-preview",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "Acme Corp prices its product between $10-$50/month.",
            annotations: [
              {
                type: "url_citation",
                url_citation: { url: "https://example.com/report", title: "Example Market Report", start_index: 0, end_index: 52 },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
  } as unknown as Response;
}) as typeof fetch;

const { runWebResearch } = await import(`../modules/onboarding/marketResearch.js?t=${Date.now()}`);

test("Market research (live) - runWebResearch parses narrative, citations, and search count from a real-shaped response", async () => {
  const result = await runWebResearch("What does Acme Corp charge for its product?");
  assert.strictEqual(result.narrative, "Acme Corp prices its product between $10-$50/month.");
  assert.strictEqual(result.searchesUsed, 1);
  assert.deepStrictEqual(result.citations, [{ url: "https://example.com/report", title: "Example Market Report" }]);
});

test("Market research (live) - identical prompts are served from cache, not a second real search", async () => {
  const callsBefore = fetchCallCount;
  const result = await runWebResearch("What does Acme Corp charge for its product?");
  assert.strictEqual(fetchCallCount, callsBefore, "second call with the same prompt should hit the cache, not fetch again");
  assert.strictEqual(result.narrative, "Acme Corp prices its product between $10-$50/month.");
});

after(() => {
  global.fetch = originalFetch;
});
