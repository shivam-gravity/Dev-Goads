import { test } from "node:test";
import assert from "node:assert";

// firecrawlClient.ts reads FIRECRAWL_API_KEY once at module-load time — set it BEFORE any
// import touches that module (directly or transitively via scrapeFallback.ts), same
// cache-busting-avoidance convention used elsewhere in this suite (see
// researchProviders.test.ts's comment on openaiClient.ts), so every test in this file
// consistently sees Firecrawl as "configured" and can exercise the fallback-to-Firecrawl path.
process.env.FIRECRAWL_API_KEY = "test-key";

const { mapUrlWithFallback, scrapeUrlWithFallback, crawlUrlWithFallback } = await import("../infra/scrapeFallback.js");
// firecrawlClient.ts's credit-budget check opens a real (lazy-connect) Redis connection the
// moment any test here has FIRECRAWL_API_KEY set and calls it — same cleanup
// distributedLock.test.ts needs, for the same reason (an unclosed connection keeps the
// process alive after every test has already finished).
const { redisClient } = await import("../infra/redisClient.js");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function isFirecrawlUrl(url: string): boolean {
  return url.includes("api.firecrawl.dev");
}

test("scrapeUrlWithFallback - in-house scrape succeeding never calls Firecrawl", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (isFirecrawlUrl(urlStr)) throw new Error(`must not reach Firecrawl: ${urlStr}`);
    if (urlStr.includes("/research/scrape")) {
      return jsonResponse({ markdown: "# Hello\nreal content here", html: "<h1>Hello</h1>", links: [], metadata: { statusCode: 200 } });
    }
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

test("scrapeUrlWithFallback - in-house scrape failing falls through to a succeeding Firecrawl call", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/research/scrape")) throw new Error("scraper-service unreachable (simulated)");
    if (isFirecrawlUrl(urlStr) && urlStr.includes("/scrape")) {
      return jsonResponse({ success: true, data: { markdown: "firecrawl markdown", metadata: { statusCode: 200 } } });
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.source, "firecrawl");
    assert.strictEqual(result.outage, null);
    assert.strictEqual(result.data?.markdown, "firecrawl markdown");
  } finally {
    global.fetch = original;
  }
});

test("scrapeUrlWithFallback - in-house scrape returning a bot-block-shaped page falls through to Firecrawl instead of accepting it as success", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/research/scrape")) {
      // Real HTTP 200, but the content is a CAPTCHA page — must be treated as unusable, not a
      // successful in-house result, so isUsableScrapeData's bot-block check is exercised here.
      return jsonResponse({ markdown: "Please complete the CAPTCHA to continue", html: "", links: [], metadata: { statusCode: 200 } });
    }
    if (isFirecrawlUrl(urlStr) && urlStr.includes("/scrape")) {
      return jsonResponse({ success: true, data: { markdown: "real firecrawl content", metadata: { statusCode: 200 } } });
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.source, "firecrawl");
    assert.strictEqual(result.data?.markdown, "real firecrawl content");
  } finally {
    global.fetch = original;
  }
});

test("scrapeUrlWithFallback - both in-house and Firecrawl failing still degrades gracefully, never throws", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("network unavailable (simulated)");
  }) as typeof fetch;

  try {
    const result = await scrapeUrlWithFallback("https://example.com", ["markdown"]);
    assert.strictEqual(result.data, null);
  } finally {
    global.fetch = original;
  }
});

test("mapUrlWithFallback - in-house sitemap discovery succeeding never calls Firecrawl", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (isFirecrawlUrl(urlStr)) throw new Error(`must not reach Firecrawl: ${urlStr}`);
    if (urlStr.includes("/sitemap.xml")) {
      return new Response(
        `<?xml version="1.0"?><urlset><url><loc>https://example.com/pricing</loc></url></urlset>`,
        { status: 200 }
      );
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await mapUrlWithFallback("https://example.com", { limit: 10 });
    assert.strictEqual(result.source, "inhouse");
    assert.ok(result.links.some((l) => l.url === "https://example.com/pricing"));
  } finally {
    global.fetch = original;
  }
});

test("mapUrlWithFallback - no sitemap and no scraper-service links falls through to a succeeding Firecrawl map call", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("/sitemap.xml") || urlStr.includes("/robots.txt")) return new Response("", { status: 404 });
    if (urlStr.includes("/research/scrape")) return jsonResponse({ markdown: "", html: "", links: [], metadata: {} });
    if (isFirecrawlUrl(urlStr) && urlStr.includes("/map")) {
      return jsonResponse({ success: true, links: [{ url: "https://example.com/about" }] });
    }
    throw new Error(`unexpected fetch: ${urlStr}`);
  }) as typeof fetch;

  try {
    const result = await mapUrlWithFallback("https://example.com", { limit: 10 });
    assert.strictEqual(result.source, "firecrawl");
    assert.deepStrictEqual(result.links, [{ url: "https://example.com/about" }]);
  } finally {
    global.fetch = original;
  }
});

test("crawlUrlWithFallback - in-house crawl succeeding never calls Firecrawl", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (isFirecrawlUrl(urlStr)) throw new Error(`must not reach Firecrawl: ${urlStr}`);
    if (urlStr.includes("/sitemap.xml") || urlStr.includes("/robots.txt")) return new Response("", { status: 404 });
    if (urlStr.includes("/products/scrape")) {
      // scrapeUrl's internal captureScreenshot call, hit via the entry page's own crawl —
      // best-effort, fine to return no screenshot here.
      return jsonResponse({ screenshot: undefined });
    }
    // scrapeUrl's own cheerio-based entry page fetch.
    return new Response(`<html><head><title>Example</title></head><body><h1>Hello</h1><p>Real page content here for the crawl.</p></body></html>`, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await crawlUrlWithFallback("https://example.com", { limit: 5 });
    assert.strictEqual(result.source, "inhouse");
    assert.ok(result.pages.length > 0);
    assert.match(result.pages[0].markdown ?? "", /Real page content/);
  } finally {
    global.fetch = original;
  }
});

test.after(async () => {
  delete process.env.FIRECRAWL_API_KEY;
  await redisClient.quit();
});
