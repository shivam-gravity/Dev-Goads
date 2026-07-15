import { test } from "node:test";
import assert from "node:assert";

delete process.env.SERPER_API_KEY;

const original = global.fetch;
global.fetch = (async (url: unknown) => {
  throw new Error(`serperClient must not make any network call when unconfigured: ${String(url)}`);
}) as typeof fetch;

const { serperSearch, isSerperConfigured } = await import("../infra/serperClient.js");

test("serperClient.serperSearch - no SERPER_API_KEY returns empty results with a no-key outage, without any network call", async () => {
  const result = await serperSearch("test query");
  assert.deepStrictEqual(result, { results: [], outage: "no-key" });
});

test("serperClient.isSerperConfigured - false without SERPER_API_KEY", () => {
  assert.strictEqual(isSerperConfigured(), false);
});

test("serperClient.serperSearch - with a key, hits google.serper.dev/search and normalizes organic results (including real position order)", async () => {
  process.env.SERPER_API_KEY = "test-serper-key";
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (!urlStr.includes("google.serper.dev/search")) throw new Error(`unexpected fetch: ${urlStr}`);
    return new Response(
      JSON.stringify({
        organic: [
          { title: "Acme Corp Official Site", link: "https://acme.com", snippet: "Acme sells widgets.", position: 1 },
          { title: "Acme Corp Reviews", link: "https://reviews.example.com/acme", snippet: "4.5 stars.", position: 2 },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await serperSearch("Acme Corp");
    assert.deepStrictEqual(result, {
      results: [
        { title: "Acme Corp Official Site", url: "https://acme.com", snippet: "Acme sells widgets." },
        { title: "Acme Corp Reviews", url: "https://reviews.example.com/acme", snippet: "4.5 stars." },
      ],
      outage: null,
    });
  } finally {
    delete process.env.SERPER_API_KEY;
  }
});

test("serperClient.serperSearch - a non-ok response degrades to empty results, never throws", async () => {
  process.env.SERPER_API_KEY = "test-serper-key";
  global.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;

  try {
    const result = await serperSearch("Acme Corp");
    assert.deepStrictEqual(result, { results: [], outage: null });
  } finally {
    delete process.env.SERPER_API_KEY;
  }
});

test.after(() => {
  global.fetch = original;
});
