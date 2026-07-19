import { test } from "node:test";
import assert from "node:assert";

// The scrape layer now runs the in-house scraper (scraper-service) and the self-hosted
// crawl4ai service CONCURRENTLY and merges their output — there is no metered vendor and no
// credit budget anymore (Firecrawl was removed). Set CRAWL4AI_BASE_URL so the crawl4ai branch
// is "configured" and actually attempts its call; each test's global.fetch mock decides what
// each source returns.
process.env.CRAWL4AI_BASE_URL = "http://localhost:11235";

const { mapUrlWithFallback, scrapeUrlWithFallback, crawlUrlWithFallback } = await import("../infra/scrapeFallback.js");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function isCrawl4aiUrl(url: string): boolean {
  return url.includes("localhost:11235");
}

test("scrapeUrlWithFallback - only the in-house scrape returning content yields source 'inhouse'", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/research/scrape")) {
      return jsonResponse({ markdown: "# Hello\nreal content here", html: "<h1>Hello</h1>", links: [], metadata: { statusCode: 200 } });
    }
    if (isCrawl4aiUrl(urlStr)) return jsonResponse({ results: [{ success: false }] }); // crawl4ai produced nothing
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.source, "inhouse");
    assert.strictEqual(result.outage, null);
    assert.strictEqual(result.data?.markdown, "# Hello\nreal content here");
  } finally {
    global.fetch = original;
  }
});

test("scrapeUrlWithFallback - in-house failing while crawl4ai succeeds yields source 'crawl4ai'", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/research/scrape")) throw new Error("scraper-service unreachable (simulated)");
    if (isCrawl4aiUrl(urlStr)) {
      return jsonResponse({ results: [{ success: true, markdown: "crawl4ai markdown here that is real", status_code: 200, url: "https://example.com" }] });
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.source, "crawl4ai");
    assert.strictEqual(result.outage, null);
    assert.match(result.data?.markdown ?? "", /crawl4ai markdown/);
  } finally {
    global.fetch = original;
  }
});

test("scrapeUrlWithFallback - both sources returning content merges them (source 'merged'), richer markdown wins", async () => {
  const original = global.fetch;
  const longMarkdown = "crawl4ai body ".repeat(40); // clearly longer than the in-house snippet
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/research/scrape")) {
      return jsonResponse({ markdown: "short in-house body that is long enough to be usable content here", html: "<h1>H</h1>", links: ["https://example.com/a"], metadata: { statusCode: 200 } });
    }
    if (isCrawl4aiUrl(urlStr)) {
      return jsonResponse({ results: [{ success: true, markdown: longMarkdown, links: { internal: [{ href: "https://example.com/b" }] }, status_code: 200, url: "https://example.com" }] });
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.source, "merged");
    assert.match(result.data?.markdown ?? "", /crawl4ai body/, "richer (longer) markdown should win the merge");
    // links from both sources are unioned
    assert.ok(result.data?.links?.includes("https://example.com/a"));
    assert.ok(result.data?.links?.includes("https://example.com/b"));
  } finally {
    global.fetch = original;
  }
});

test("scrapeUrlWithFallback - an in-house bot-block page is rejected, crawl4ai content is used instead", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/research/scrape")) {
      return jsonResponse({ markdown: "Please complete the CAPTCHA to continue", html: "", links: [], metadata: { statusCode: 200 } });
    }
    if (isCrawl4aiUrl(urlStr)) {
      return jsonResponse({ results: [{ success: true, markdown: "real crawl4ai content here", status_code: 200, url: "https://example.com" }] });
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.source, "crawl4ai");
    assert.match(result.data?.markdown ?? "", /real crawl4ai content/);
  } finally {
    global.fetch = original;
  }
});

test("scrapeUrlWithFallback - both sources failing degrades gracefully to source 'none', never throws", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("network unavailable (simulated)");
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.data, null);
    assert.strictEqual(result.source, "none");
  } finally {
    global.fetch = original;
  }
});

test("mapUrlWithFallback - in-house sitemap links and crawl4ai links merge, de-duplicated by pathname", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/sitemap.xml")) {
      return new Response(
        `<?xml version="1.0"?><urlset><url><loc>https://example.com/pricing</loc></url></urlset>`,
        { status: 200 }
      );
    }
    if (isCrawl4aiUrl(urlStr)) {
      return jsonResponse({ results: [{ success: true, links: { internal: [{ href: "https://example.com/about" }, { href: "https://example.com/pricing" }] }, status_code: 200, url: "https://example.com" }] });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await mapUrlWithFallback("https://example.com", { limit: 10 });
    assert.strictEqual(result.source, "merged");
    assert.ok(result.links.some((l) => l.url === "https://example.com/pricing"));
    assert.ok(result.links.some((l) => l.url === "https://example.com/about"));
    // /pricing appears in both sources but is de-duplicated
    assert.strictEqual(result.links.filter((l) => l.url.endsWith("/pricing")).length, 1);
  } finally {
    global.fetch = original;
  }
});

test("crawlUrlWithFallback - in-house crawl content and crawl4ai pages both appear in the merged result", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/sitemap.xml") || urlStr.includes("/robots.txt")) return new Response("", { status: 404 });
    if (urlStr.includes("/products/scrape")) return jsonResponse({ screenshot: undefined });
    if (isCrawl4aiUrl(urlStr)) {
      return jsonResponse({ results: [{ success: true, markdown: "crawl4ai page body", status_code: 200, url: "https://example.com/other" }] });
    }
    // scrapeUrl's own cheerio-based entry page fetch.
    return new Response(`<html><head><title>Example</title></head><body><h1>Hello</h1><p>Real page content here for the crawl.</p></body></html>`, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await crawlUrlWithFallback("https://example.com", { limit: 5 });
    assert.ok(["inhouse", "merged"].includes(result.source), `expected inhouse or merged, got ${result.source}`);
    assert.ok(result.pages.length > 0);
  } finally {
    global.fetch = original;
  }
});

test.after(() => {
  delete process.env.CRAWL4AI_BASE_URL;
});
