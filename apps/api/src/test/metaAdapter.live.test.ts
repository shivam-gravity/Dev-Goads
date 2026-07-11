import { test } from "node:test";
import assert from "node:assert";

// Live-credential paths are gated by env vars read at module load time, so they
// must be set before the adapter module is imported — hence the dynamic import
// and a dedicated test file, isolated from metaAdapter.test.ts's mock-path run.
process.env.META_ACCESS_TOKEN = "test-access-token";
process.env.META_AD_ACCOUNT_ID = "9876543210";

const { metaAdapter } = await import("../modules/adapters/metaAdapter.js");

function withMockFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  global.fetch = impl;
  return run().finally(() => {
    global.fetch = original;
  });
}

test("Meta Ads Adapter (live) - launchVariant calls the Graph API and returns the ad id", async () => {
  await withMockFetch(
    (async (url: string) => {
      assert.ok(String(url).includes("act_9876543210/ads"));
      assert.ok(String(url).includes("test-access-token"));
      return { ok: true, json: async () => ({ id: "meta_123456" }) } as Response;
    }) as typeof fetch,
    async () => {
      const result = await metaAdapter.launchVariant({
        campaignId: "camp-1",
        variantId: "var-1",
        creative: { headline: "Headline", body: "Body", callToAction: "Learn More" },
        dailyBudgetCents: 5000,
      });
      assert.strictEqual(result.externalId, "meta_123456");
      assert.strictEqual(result.status, "active");
    }
  );
});

test("Meta Ads Adapter (live) - launchVariant throws after exhausting retries on repeated failure", async () => {
  let calls = 0;
  await withMockFetch(
    (async () => {
      calls++;
      return { ok: false, status: 500, text: async () => "server error" } as Response;
    }) as typeof fetch,
    async () => {
      await assert.rejects(() =>
        metaAdapter.launchVariant({
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

test("Meta Ads Adapter (live) - fetchInsights parses metrics from the insights endpoint", async () => {
  await withMockFetch(
    (async (url: string) => {
      assert.ok(String(url).includes("/insights"));
      return {
        ok: true,
        json: async () => ({
          data: [{ impressions: "2000", reach: "1400", clicks: "80", spend: "40.00", actions: [{ action_type: "offsite_conversion", value: "6" }] }],
        }),
      } as Response;
    }) as typeof fetch,
    async () => {
      const stats = await metaAdapter.fetchInsights("meta_123456", "2026-07-06");
      assert.deepStrictEqual(stats, { impressions: 2000, reach: 1400, clicks: 80, conversions: 6, spendCents: 4000 });
    }
  );
});
