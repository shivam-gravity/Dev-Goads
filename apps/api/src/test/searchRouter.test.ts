import { test } from "node:test";
import assert from "node:assert";

// SearXNG is the only backend now (Tavily/Serper removed). It uses plain fetch() per call and
// reads SEARXNG_BASE_URL fresh every time, so a simple global.fetch reassignment per test is
// reliable here with no special indirection needed.
process.env.SEARXNG_BASE_URL = "http://localhost:8888";

const { runSearch } = await import("../infra/searchRouter.js");

function isUrl(url: string | URL | Request, needle: string): boolean {
  return String(url instanceof Request ? url.url : url).includes(needle);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function searxngResult(title: string) {
  return jsonResponse({ results: [{ title, url: `https://${title.toLowerCase()}.com`, content: `${title} content` }] });
}

test("searchRouter.runSearch - a searxng search succeeds and reports the searxng source", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    if (isUrl(url, "localhost:8888")) return searxngResult("Acme");
    throw new Error(`must not reach any other backend: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runSearch({ provider: "searxng" }, "Acme Corp");
    assert.strictEqual(result.source, "searxng");
    assert.strictEqual(result.searchesUsed, 1);
    assert.strictEqual(result.results[0]?.title, "Acme");
  } finally {
    global.fetch = original;
  }
});

test("searchRouter.runSearch - includeDomains are expressed as site: operators in the query", async () => {
  const original = global.fetch;
  let sentQuery = "";
  global.fetch = (async (url) => {
    const u = new URL(String(url instanceof Request ? url.url : url));
    sentQuery = u.searchParams.get("q") ?? "";
    return searxngResult("Acme");
  }) as typeof fetch;

  try {
    await runSearch({ provider: "searxng" }, "Acme reviews", { includeDomains: ["g2.com", "trustpilot.com"] });
    assert.ok(sentQuery.includes("site:g2.com"), `query should carry site: scope, got: ${sentQuery}`);
    assert.ok(sentQuery.includes("site:trustpilot.com"));
    assert.ok(sentQuery.includes("Acme reviews"));
  } finally {
    global.fetch = original;
  }
});

test("searchRouter.runSearch - a searxng failure degrades gracefully, never throws", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("network unavailable (simulated)");
  }) as typeof fetch;

  try {
    const result = await runSearch({ provider: "searxng" }, "Acme Corp");
    assert.deepStrictEqual(result.results, []);
    assert.strictEqual(result.searchesUsed, 0);
    assert.strictEqual(result.source, "searxng");
  } finally {
    global.fetch = original;
  }
});

test.after(() => {
  delete process.env.SEARXNG_BASE_URL;
});
