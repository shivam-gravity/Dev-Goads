import { test } from "node:test";
import assert from "node:assert";

delete process.env.TAVILY_API_KEY;

const original = global.fetch;
global.fetch = (async (url: unknown) => {
  throw new Error(`tavilyClient must not make any network call when unconfigured: ${String(url)}`);
}) as typeof fetch;

const { tavilySearch, isTavilyConfigured } = await import("../infra/tavilyClient.js");

test("tavilyClient.tavilySearch - no TAVILY_API_KEY returns empty results with a no-key outage, without any network call", async () => {
  const result = await tavilySearch("test query");
  assert.deepStrictEqual(result, { results: [], outage: "no-key" });
});

test("tavilyClient.isTavilyConfigured - false without TAVILY_API_KEY", () => {
  assert.strictEqual(isTavilyConfigured(), false);
});

test("tavilyClient.tavilySearch - with a key, hits api.tavily.com/search and normalizes results", async () => {
  process.env.TAVILY_API_KEY = "test-tavily-key";
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (!urlStr.includes("api.tavily.com/search")) throw new Error(`unexpected fetch: ${urlStr}`);
    return new Response(
      JSON.stringify({ results: [{ title: "Acme Corp", url: "https://acme.com", content: "Acme sells widgets." }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await tavilySearch("Acme Corp");
    assert.deepStrictEqual(result, { results: [{ title: "Acme Corp", url: "https://acme.com", snippet: "Acme sells widgets." }], outage: null });
  } finally {
    delete process.env.TAVILY_API_KEY;
  }
});

test("tavilyClient.tavilySearch - a non-ok response degrades to empty results, never throws", async () => {
  process.env.TAVILY_API_KEY = "test-tavily-key";
  global.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;

  try {
    const result = await tavilySearch("Acme Corp");
    assert.deepStrictEqual(result, { results: [], outage: null });
  } finally {
    delete process.env.TAVILY_API_KEY;
  }
});

test.after(() => {
  global.fetch = original;
});
