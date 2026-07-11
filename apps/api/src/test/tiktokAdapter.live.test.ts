import { test } from "node:test";
import assert from "node:assert";

// Live-credential paths are gated by env vars read at module load time, so they
// must be set before the adapter module is imported — hence the dynamic import
// and a dedicated test file, isolated from tiktokAdapter.test.ts's mock-path run.
process.env.TIKTOK_ACCESS_TOKEN = "test-access-token";
process.env.TIKTOK_ADVERTISER_ID = "1234567890";

const { tiktokAdapter } = await import("../modules/adapters/tiktokAdapter.js");

function withMockFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  global.fetch = impl;
  return run().finally(() => {
    global.fetch = original;
  });
}

test("TikTok Ads Adapter (live) - launchVariant calls the ad create endpoint and returns the ad id", async () => {
  await withMockFetch(
    (async (url: string, options: any) => {
      assert.ok(String(url).includes("/ad/create/"));
      assert.strictEqual(options.headers["Access-Token"], "test-access-token");
      return { ok: true, json: async () => ({ data: { ad_ids: ["tiktok_123456"] } }) } as Response;
    }) as typeof fetch,
    async () => {
      const result = await tiktokAdapter.launchVariant({
        campaignId: "camp-1",
        variantId: "var-1",
        creative: { headline: "Headline", body: "Body", callToAction: "Learn More" },
        dailyBudgetCents: 5000,
      });
      assert.strictEqual(result.externalId, "tiktok_123456");
      assert.strictEqual(result.status, "active");
    }
  );
});

test("TikTok Ads Adapter (live) - launchVariant throws after exhausting retries on repeated failure", async () => {
  let calls = 0;
  await withMockFetch(
    (async () => {
      calls++;
      return { ok: false, status: 500, text: async () => "server error" } as Response;
    }) as typeof fetch,
    async () => {
      await assert.rejects(() =>
        tiktokAdapter.launchVariant({
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

test("TikTok Ads Adapter (live) - fetchInsights parses metrics from the report endpoint", async () => {
  await withMockFetch(
    (async (url: string) => {
      assert.ok(String(url).includes("/report/integrated/get/"));
      return {
        ok: true,
        json: async () => ({ data: { list: [{ metrics: { impressions: "1000", reach: "700", clicks: "40", conversions: "4", spend: "20.00" } }] } }),
      } as Response;
    }) as typeof fetch,
    async () => {
      const stats = await tiktokAdapter.fetchInsights("tiktok_123456", "2026-07-06");
      assert.deepStrictEqual(stats, { impressions: 1000, reach: 700, clicks: 40, conversions: 4, spendCents: 2000 });
    }
  );
});
