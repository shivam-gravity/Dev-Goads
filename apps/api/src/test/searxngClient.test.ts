import { test } from "node:test";
import assert from "node:assert";

delete process.env.SEARXNG_BASE_URL;

const original = global.fetch;
global.fetch = (async (url: unknown) => {
  throw new Error(`searxngClient must not make any network call when unconfigured: ${String(url)}`);
}) as typeof fetch;

const { searxngSearch, isSearxngConfigured } = await import("../infra/searxngClient.js");

test("searxngClient.searxngSearch - no SEARXNG_BASE_URL returns empty results with a no-key outage, without any network call", async () => {
  const result = await searxngSearch("test query");
  assert.deepStrictEqual(result, { results: [], outage: "no-key" });
});

test("searxngClient.isSearxngConfigured - false without SEARXNG_BASE_URL", () => {
  assert.strictEqual(isSearxngConfigured(), false);
});

test("searxngClient.searxngSearch - with a base URL, hits <base>/search?format=json and normalizes results", async () => {
  process.env.SEARXNG_BASE_URL = "http://localhost:8888";
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (!urlStr.startsWith("http://localhost:8888/search") || !urlStr.includes("format=json")) throw new Error(`unexpected fetch: ${urlStr}`);
    return new Response(
      JSON.stringify({ results: [{ title: "Acme Corp", url: "https://acme.com", content: "Acme sells widgets." }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await searxngSearch("Acme Corp");
    assert.deepStrictEqual(result, { results: [{ title: "Acme Corp", url: "https://acme.com", snippet: "Acme sells widgets." }], outage: null });
  } finally {
    delete process.env.SEARXNG_BASE_URL;
  }
});

test("searxngClient.searxngSearch - an unreachable instance degrades to empty results, never throws", async () => {
  process.env.SEARXNG_BASE_URL = "http://localhost:8888";
  global.fetch = (async () => {
    throw new Error("connection refused (simulated)");
  }) as typeof fetch;

  try {
    const result = await searxngSearch("Acme Corp");
    assert.deepStrictEqual(result, { results: [], outage: null });
  } finally {
    delete process.env.SEARXNG_BASE_URL;
  }
});

test.after(() => {
  global.fetch = original;
});
