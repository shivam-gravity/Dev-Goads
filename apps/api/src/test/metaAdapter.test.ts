import { test } from "node:test";
import assert from "node:assert";

// Runs in the same process as every other test file (see the combined `npm test` invocation)
// — if a file that ran earlier already caused real live credentials to load into process.env
// (e.g. via a Prisma import's dotenv side effect), this file's "mock mode" assumptions would
// silently break. Cleared before the first import of metaAdapter.js (reads these once, at
// module load time), same fix as metaAdapter.live.test.ts's own explicit env setup.
delete process.env.META_ACCESS_TOKEN;
delete process.env.META_AD_ACCOUNT_ID;

const { metaAdapter } = await import("../modules/adapters/metaAdapter.js");

test("Meta Ads Adapter - launchVariant fallback placement validation", async () => {
  const result = await metaAdapter.launchVariant({
    campaignId: "camp-test-1",
    variantId: "var-test-1",
    creative: { headline: "Scale Your Lead Gen in 15 Mins", body: "Automated campaigns that convert.", callToAction: "Learn More" },
    dailyBudgetCents: 10000,
  });

  assert.ok(result.externalId, "Should generate a mock ad ID");
  assert.strictEqual(result.status, "active", "Mock ad state should be active");
  assert.ok(result.externalId.startsWith("meta_ad_"), "Ad ID should follow meta prefix pattern");
});

test("Meta Ads Adapter - pauseVariant and setBudget resolve without live credentials", async () => {
  await assert.doesNotReject(() => metaAdapter.pauseVariant("meta_ad_test"));
  await assert.doesNotReject(() => metaAdapter.setBudget({ externalId: "meta_ad_test", dailyBudgetCents: 5000 }));
});

test("Meta Ads Adapter - fetchInsights returns honest zeros when no account is connected (no fabricated data)", async () => {
  const stats = await metaAdapter.fetchInsights("meta_ad_test", new Date().toISOString().slice(0, 10));

  // With no credentials the adapter must NOT invent metrics — it returns real zeros so the UI
  // shows a "no data yet" state instead of Math.random() performance presented as real.
  assert.strictEqual(stats.impressions, 0);
  assert.strictEqual(stats.reach, 0);
  assert.strictEqual(stats.clicks, 0);
  assert.strictEqual(stats.conversions, 0);
  assert.strictEqual(stats.spendCents, 0);
});
