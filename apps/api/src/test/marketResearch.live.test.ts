import { test, after } from "node:test";
import assert from "node:assert";

// Anthropic's client captures `fetch` at construction time (`new Anthropic()`, which
// marketResearch.ts does at module load), so the mock must be installed BEFORE the
// dynamic import runs — same ordering constraint as metaAdapter.live.test.ts, just for
// module-load-time construction instead of a per-call fetch.
process.env.ANTHROPIC_API_KEY = "test-key";

let fetchCallCount = 0;
const originalFetch = global.fetch;
global.fetch = (async (url: string) => {
  fetchCallCount++;
  assert.ok(String(url).includes("api.anthropic.com"));
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [
        { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Acme Corp pricing" } },
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: [{ type: "web_search_result", url: "https://example.com/report", title: "Example Market Report", encrypted_content: "x", page_age: null }],
        },
        {
          type: "text",
          text: "Acme Corp prices its product between $10-$50/month.",
          citations: [{ type: "web_search_result_location", url: "https://example.com/report", title: "Example Market Report", cited_text: "$10-$50/month", encrypted_index: "x" }],
        },
      ],
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
