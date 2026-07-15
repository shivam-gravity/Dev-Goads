import { test } from "node:test";
import assert from "node:assert";

// Unlike llmRouter.ts's Groq/Ollama clients (OpenAI-SDK-backed, capture fetch once at
// client-construction time — see infra/dynamicFetch.ts), tavily/serper/searxng all use
// plain fetch() per call and read their env-based config fresh every time, so a simple
// global.fetch reassignment per test is reliable here with no special indirection needed.
process.env.TAVILY_API_KEY = "test-tavily-key";
process.env.SERPER_API_KEY = "test-serper-key";
process.env.SEARXNG_BASE_URL = "http://localhost:8888";

const { runSearch } = await import("../infra/searchRouter.js");

function isUrl(url: string | URL | Request, needle: string): boolean {
  return String(url instanceof Request ? url.url : url).includes(needle);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function tavilyResult(title: string) {
  return jsonResponse({ results: [{ title, url: `https://${title.toLowerCase()}.com`, content: `${title} content` }] });
}

test("searchRouter.runSearch - a tavily assignment succeeding never reaches serper or searxng", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    if (isUrl(url, "api.tavily.com")) return tavilyResult("Acme");
    throw new Error(`must not reach any other backend: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runSearch({ provider: "tavily" }, "Acme Corp");
    assert.strictEqual(result.source, "tavily");
    assert.strictEqual(result.searchesUsed, 1);
    assert.strictEqual(result.results[0]?.title, "Acme");
  } finally {
    global.fetch = original;
  }
});

test("searchRouter.runSearch - a tavily assignment failing falls back to a succeeding serper call", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    if (isUrl(url, "api.tavily.com")) throw new Error("tavily unreachable (simulated)");
    if (isUrl(url, "google.serper.dev")) return jsonResponse({ organic: [{ title: "Acme", link: "https://acme.com", snippet: "Acme content", position: 1 }] });
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runSearch({ provider: "tavily" }, "Acme Corp");
    assert.strictEqual(result.source, "serper");
    assert.strictEqual(result.searchesUsed, 1);
  } finally {
    global.fetch = original;
  }
});

test("searchRouter.runSearch - a serper assignment (search-ranking's default) succeeding never reaches tavily or searxng", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    if (isUrl(url, "google.serper.dev")) return jsonResponse({ organic: [{ title: "Acme", link: "https://acme.com", snippet: "x", position: 1 }] });
    throw new Error(`must not reach any other backend: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runSearch({ provider: "serper" }, "Acme Corp");
    assert.strictEqual(result.source, "serper");
  } finally {
    global.fetch = original;
  }
});

test("searchRouter.runSearch - both tavily and serper failing falls back to a succeeding searxng call", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    if (isUrl(url, "api.tavily.com") || isUrl(url, "google.serper.dev")) throw new Error("unreachable (simulated)");
    if (isUrl(url, "localhost:8888")) return jsonResponse({ results: [{ title: "Acme", url: "https://acme.com", content: "x" }] });
    throw new Error(`unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const result = await runSearch({ provider: "tavily" }, "Acme Corp");
    assert.strictEqual(result.source, "searxng");
    assert.strictEqual(result.searchesUsed, 1);
  } finally {
    global.fetch = original;
  }
});

test("searchRouter.runSearch - all three providers failing still degrades gracefully, never throws", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("network unavailable (simulated)");
  }) as typeof fetch;

  try {
    const result = await runSearch({ provider: "tavily" }, "Acme Corp");
    assert.deepStrictEqual(result.results, []);
    assert.strictEqual(result.searchesUsed, 0);
    assert.strictEqual(result.source, "tavily");
  } finally {
    global.fetch = original;
  }
});

test.after(() => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.SEARXNG_BASE_URL;
});
