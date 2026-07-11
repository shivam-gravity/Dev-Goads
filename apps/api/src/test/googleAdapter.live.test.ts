import { test } from "node:test";
import assert from "node:assert";

// Live-credential paths are gated by env vars read at module load time, so they
// must be set before the adapter module is imported — hence the dynamic import
// and a dedicated test file, isolated from googleAdapter.test.ts's mock-path run.
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token";
process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
process.env.GOOGLE_ADS_ACCESS_TOKEN = "test-access-token";

const { googleAdapter } = await import("../modules/adapters/googleAdapter.js");

function withMockFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  global.fetch = impl;
  return run().finally(() => {
    global.fetch = original;
  });
}

test("Google Ads Adapter (live) - launchVariant calls the mutate endpoint and returns the resourceName", async () => {
  await withMockFetch(
    (async (url: string, options: any) => {
      assert.ok(String(url).includes("adGroupAds:mutate"));
      assert.strictEqual(options.headers["developer-token"], "test-dev-token");
      assert.strictEqual(options.headers.Authorization, "Bearer test-access-token");
      return {
        ok: true,
        json: async () => ({ results: [{ resourceName: "customers/123/adGroupAds/456" }] }),
      } as Response;
    }) as typeof fetch,
    async () => {
      const result = await googleAdapter.launchVariant({
        campaignId: "camp-1",
        variantId: "var-1",
        creative: { headline: "Headline", body: "Body", callToAction: "Learn More" },
        dailyBudgetCents: 5000,
      });
      assert.strictEqual(result.externalId, "customers/123/adGroupAds/456");
      assert.strictEqual(result.status, "active");
    }
  );
});

test("Google Ads Adapter (live) - launchVariant throws after exhausting retries on repeated failure", async () => {
  let calls = 0;
  await withMockFetch(
    (async () => {
      calls++;
      return { ok: false, status: 500, text: async () => "server error" } as Response;
    }) as typeof fetch,
    async () => {
      await assert.rejects(() =>
        googleAdapter.launchVariant({
          campaignId: "camp-1",
          variantId: "var-1",
          creative: { headline: "Headline", body: "Body", callToAction: "Learn More" },
          dailyBudgetCents: 5000,
        })
      );
      assert.strictEqual(calls, 3, "should attempt the request 3 times before giving up");
    }
  );
});

test("Google Ads Adapter (live) - fetchInsights parses metrics from the search endpoint", async () => {
  await withMockFetch(
    (async (url: string) => {
      assert.ok(String(url).includes("googleAds:search"));
      return {
        ok: true,
        json: async () => ({
          results: [{ metrics: { impressions: "1000", clicks: "50", conversions: "5", costMicros: "2000000" } }],
        }),
      } as Response;
    }) as typeof fetch,
    async () => {
      const stats = await googleAdapter.fetchInsights("customers/123/adGroupAds/456", "2026-07-06");
      // reach has no native ad_group_ad-level field in the Google Ads API for Search, so
      // the adapter estimates it as impressions * 0.65 (see googleAdapter.ts's comment) —
      // not read from the response, so it's derived here rather than added to the fixture.
      assert.deepStrictEqual(stats, { impressions: 1000, reach: 650, clicks: 50, conversions: 5, spendCents: 200 });
    }
  );
});
