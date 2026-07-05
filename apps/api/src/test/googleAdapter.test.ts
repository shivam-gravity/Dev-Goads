import { test } from "node:test";
import assert from "node:assert";
import { googleAdapter } from "../modules/adapters/googleAdapter.js";

test("Google Ads Adapter - launchVariant fallback placement validation", async () => {
  const result = await googleAdapter.launchVariant({
    campaignId: "camp-test-1",
    variantId: "var-test-1",
    creative: { headline: "Scale Your Lead Gen in 15 Mins", body: "Automated campaigns that convert.", callToAction: "Learn More" },
    dailyBudgetCents: 10000,
  });

  assert.ok(result.externalId, "Should generate a mock ad ID");
  assert.strictEqual(result.status, "active", "Mock ad state should be active");
  assert.ok(result.externalId.startsWith("gads_ad_"), "Ad ID should follow google prefix pattern");
});

test("Google Ads Adapter - fetchInsights mock metrics ranges", async () => {
  const stats = await googleAdapter.fetchInsights("gads_ad_test", new Date().toISOString().slice(0, 10));
  
  assert.ok(stats.impressions >= 1500, "Impressions should be within mock bounds");
  assert.ok(stats.clicks <= stats.impressions, "Clicks cannot exceed impressions");
  assert.ok(stats.conversions <= stats.clicks, "Conversions cannot exceed clicks");
  assert.ok(stats.spendCents > 0, "Spend must be greater than zero");
});
