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
      // fields= includes "reach" (see metaAdapter.ts's fetchInsights URL) — the mocked
      // response must include it too, or the parsed result legitimately (and correctly)
      // defaults it to 0, which used to look like a bug here rather than a stale fixture.
      return {
        ok: true,
        json: async () => ({
          data: [{
            impressions: "2000", reach: "1500", clicks: "80", spend: "40.00",
            // Each funnel step is its own action_type row alongside the conversion count.
            actions: [
              { action_type: "offsite_conversion", value: "6" },
              { action_type: "add_to_cart", value: "20" },
              { action_type: "add_payment_info", value: "9" },
              { action_type: "purchase", value: "6" },
            ],
            // action_values carries the real purchase VALUE parallel to actions' count.
            action_values: [{ action_type: "offsite_conversion", value: "150.00" }],
          }],
        }),
      } as Response;
    }) as typeof fetch,
    async () => {
      const stats = await metaAdapter.fetchInsights("meta_123456", "2026-07-06");
      // revenueCents = action_values offsite_conversion (150.00) * 100 → true ROAS input.
      // funnel breaks out per-step counts (add_to_cart/add_payment_info/purchase) from `actions`.
      assert.deepStrictEqual(stats, {
        impressions: 2000, reach: 1500, clicks: 80, conversions: 6, spendCents: 4000, revenueCents: 15000,
        funnel: { addToCart: 20, addPaymentInfo: 9, purchases: 6, purchaseValueCents: 15000 },
      });
    }
  );
});
