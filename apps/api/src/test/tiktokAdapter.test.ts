import { test } from "node:test";
import assert from "node:assert";
import { tiktokAdapter } from "../modules/adapters/tiktokAdapter.js";

test("TikTok Ads Adapter - launchVariant fallback placement validation", async () => {
  const result = await tiktokAdapter.launchVariant({
    campaignId: "camp-test-1",
    variantId: "var-test-1",
    creative: { headline: "Scale Your Lead Gen in 15 Mins", body: "Automated campaigns that convert.", callToAction: "Learn More" },
    dailyBudgetCents: 10000,
  });

  assert.ok(result.externalId, "Should generate a mock ad ID");
  assert.strictEqual(result.status, "active", "Mock ad state should be active");
  assert.ok(result.externalId.startsWith("tiktok_ad_"), "Ad ID should follow tiktok prefix pattern");
});

test("TikTok Ads Adapter - pauseVariant and setBudget resolve without live credentials", async () => {
  await assert.doesNotReject(() => tiktokAdapter.pauseVariant("tiktok_ad_test"));
  await assert.doesNotReject(() => tiktokAdapter.setBudget({ externalId: "tiktok_ad_test", dailyBudgetCents: 5000 }));
});

test("TikTok Ads Adapter - fetchInsights mock metrics ranges", async () => {
  const stats = await tiktokAdapter.fetchInsights("tiktok_ad_test", new Date().toISOString().slice(0, 10));

  assert.ok(stats.impressions >= 1800, "Impressions should be within mock bounds");
  assert.ok(stats.clicks <= stats.impressions, "Clicks cannot exceed impressions");
  assert.ok(stats.conversions <= stats.clicks, "Conversions cannot exceed clicks");
  assert.ok(stats.spendCents > 0, "Spend must be greater than zero");
});
