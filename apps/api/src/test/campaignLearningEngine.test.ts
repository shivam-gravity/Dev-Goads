import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { analyticsStore } from "../infra/analyticsStore.js";
import { recordCampaignOutcome } from "../research/decision/campaign-learning-engine.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";
import type { PerformanceMetric } from "../types/index.js";

after(disconnectTestInfra);

function fakeMetric(campaignId: string, overrides: Partial<PerformanceMetric> = {}): PerformanceMetric {
  return {
    id: randomUUID(),
    campaignId,
    variantId: "variant-1",
    network: "meta",
    date: new Date().toISOString().slice(0, 10),
    impressions: 1000,
    reach: 700,
    clicks: 40,
    conversions: 6,
    spendCents: 2000,
    revenueCents: 12000,
    ...overrides,
  };
}

test("recordCampaignOutcome - returns null when the campaign has no metrics at all", async () => {
  const outcome = await recordCampaignOutcome(`camp-no-metrics-${Date.now()}`);
  assert.strictEqual(outcome, null);
});

test("recordCampaignOutcome - returns null when total conversions are below the significance floor", async () => {
  const campaignId = `camp-low-conv-${Date.now()}`;
  await analyticsStore.recordMetric(fakeMetric(campaignId, { conversions: 2, clicks: 40, impressions: 1000 }));

  const outcome = await recordCampaignOutcome(campaignId);
  assert.strictEqual(outcome, null, "2 conversions is below MIN_CONVERSIONS_FOR_OUTCOME (5)");
});

test("recordCampaignOutcome - computes a real outcome score once there's enough conversion data", async () => {
  const campaignId = `camp-real-outcome-${Date.now()}`;
  await analyticsStore.recordMetric(fakeMetric(campaignId, { impressions: 10000, clicks: 500, conversions: 50, spendCents: 20000 }));

  const outcome = await recordCampaignOutcome(campaignId);
  assert.ok(outcome, "expected a real outcome with 50 conversions");
  assert.strictEqual(outcome!.campaignId, campaignId);
  assert.strictEqual(outcome!.totalConversions, 50);
  assert.strictEqual(outcome!.ctr, 0.05, "500 clicks / 10000 impressions");
  assert.strictEqual(outcome!.conversionRate, 0.1, "50 conversions / 500 clicks");
  assert.ok(outcome!.outcomeScore > 0 && outcome!.outcomeScore <= 100, "outcomeScore must be a valid 0-100 score");
});

test("recordCampaignOutcome - aggregates across multiple variants/networks for the same campaign", async () => {
  const campaignId = `camp-multi-variant-${Date.now()}`;
  await analyticsStore.recordMetric(fakeMetric(campaignId, { variantId: "v1", network: "meta", impressions: 5000, clicks: 200, conversions: 20 }));
  await analyticsStore.recordMetric(fakeMetric(campaignId, { variantId: "v2", network: "google", impressions: 5000, clicks: 200, conversions: 20 }));

  const outcome = await recordCampaignOutcome(campaignId);
  assert.ok(outcome);
  assert.strictEqual(outcome!.totalConversions, 40, "conversions from both variants must be summed");
});

test("recordCampaignOutcome - is safe to call twice for the same campaign (idempotent, never throws)", async () => {
  const campaignId = `camp-idempotent-${Date.now()}`;
  await analyticsStore.recordMetric(fakeMetric(campaignId, { conversions: 10, clicks: 200, impressions: 4000 }));

  const first = await recordCampaignOutcome(campaignId);
  const second = await recordCampaignOutcome(campaignId);
  assert.ok(first);
  assert.ok(second);
  assert.strictEqual(first!.outcomeScore, second!.outcomeScore, "same input data must score identically both times");
});
