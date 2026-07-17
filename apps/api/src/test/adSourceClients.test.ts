import { test } from "node:test";
import assert from "node:assert";
import { fetchGoogleTransparencyAdsForQuery, fetchMetaAdsForQuery } from "../research/ad-intelligence/adSourceClients.js";

delete process.env.FIRECRAWL_API_KEY;
delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;

test("fetchMetaAdsForQuery - with no META_AD_LIBRARY_ACCESS_TOKEN, returns attempted:false with zero network calls", async () => {
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  }) as typeof fetch;

  try {
    const result = await fetchMetaAdsForQuery("Acme");
    assert.deepStrictEqual(result, { ads: [], attempted: false });
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = original;
  }
});

test("fetchMetaAdsForQuery - a successful response is attempted:true and carries the real ad id through as externalAdId", async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = "test-token";
  const original = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({ data: [{ id: "123456789", page_name: "Rival Co", ad_creative_bodies: ["Body text"], ad_creative_link_titles: ["Headline"], ad_snapshot_url: "https://facebook.com/ads/library/?id=123456789" }] }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const result = await fetchMetaAdsForQuery("Rival Co");
    assert.strictEqual(result.attempted, true);
    assert.strictEqual(result.ads.length, 1);
    assert.strictEqual(result.ads[0]?.externalAdId, "123456789");
    assert.strictEqual(result.ads[0]?.headline, "Headline");
  } finally {
    global.fetch = original;
    delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  }
});

test("fetchMetaAdsForQuery - a request failure degrades to attempted:false rather than throwing", async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = "test-token";
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const result = await fetchMetaAdsForQuery("Rival Co");
    assert.deepStrictEqual(result, { ads: [], attempted: false });
  } finally {
    global.fetch = original;
    delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  }
});

test("fetchGoogleTransparencyAdsForQuery - a successful in-house scrape is attempted:true with an in-house source", async () => {
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("api.firecrawl.dev")) throw new Error("must never reach Firecrawl directly");
    if (urlStr.includes("/research/scrape")) {
      return new Response(JSON.stringify({ links: ["https://adstransparency.google.com/advertiser/AR123"], markdown: "", html: "", metadata: {} }), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await fetchGoogleTransparencyAdsForQuery("Rival Co");
    assert.strictEqual(result.attempted, true);
    assert.strictEqual(result.source, "inhouse");
    assert.strictEqual(result.ads[0]?.externalAdId, "https://adstransparency.google.com/advertiser/AR123");
  } finally {
    global.fetch = original;
  }
});

test("fetchGoogleTransparencyAdsForQuery - a total outage degrades to attempted:false, source:null", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("in-house and Firecrawl both unreachable (simulated)");
  }) as typeof fetch;

  try {
    const result = await fetchGoogleTransparencyAdsForQuery("Rival Co");
    assert.deepStrictEqual(result, { ads: [], attempted: false, source: null });
  } finally {
    global.fetch = original;
  }
});
