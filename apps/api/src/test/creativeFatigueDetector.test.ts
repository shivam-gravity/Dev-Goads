import { test } from "node:test";
import assert from "node:assert";
import { computeFatigueScore } from "../modules/optimization/creativeFatigueDetector.js";
import type { PerformanceMetric } from "../types/index.js";

const VARIANT_ID = "variant-1";

function metric(overrides: Partial<PerformanceMetric>): PerformanceMetric {
  return {
    id: `m-${Math.random()}`,
    campaignId: "campaign-1",
    variantId: VARIANT_ID,
    network: "meta",
    date: "2026-01-01",
    impressions: 1000,
    reach: 1000,
    clicks: 20,
    conversions: 2,
    spendCents: 5000,
    revenueCents: 10000,
    ...overrides,
  };
}

test("computeFatigueScore - no data for the variant returns not-fatigued with no signal", () => {
  const result = computeFatigueScore(VARIANT_ID, []);
  assert.strictEqual(result.isFatigued, false);
  assert.strictEqual(result.frequency, null);
  assert.strictEqual(result.reason, "No performance data yet");
});

test("computeFatigueScore - high cumulative frequency (impressions >> reach) flags fatigue", () => {
  const metrics = [
    metric({ date: "2026-01-01", impressions: 4000, reach: 1000, clicks: 80 }),
  ];
  const result = computeFatigueScore(VARIANT_ID, metrics);
  assert.strictEqual(result.frequency, 4);
  assert.strictEqual(result.isFatigued, true);
  assert.match(result.reason, /frequency 4\.0 exceeds/);
});

test("computeFatigueScore - low frequency and stable CTR across two windows is not fatigued", () => {
  const metrics = [
    metric({ date: "2026-01-01", impressions: 1000, reach: 900, clicks: 20 }),
    metric({ date: "2026-01-02", impressions: 1000, reach: 900, clicks: 20 }),
    metric({ date: "2026-01-03", impressions: 1000, reach: 900, clicks: 20 }),
    metric({ date: "2026-01-04", impressions: 1000, reach: 900, clicks: 20 }),
    metric({ date: "2026-01-05", impressions: 1000, reach: 900, clicks: 20 }),
    metric({ date: "2026-01-06", impressions: 1000, reach: 900, clicks: 20 }),
  ];
  const result = computeFatigueScore(VARIANT_ID, metrics);
  assert.strictEqual(result.isFatigued, false);
  assert.strictEqual(result.ctrDeclineRatio, 0);
});

test("computeFatigueScore - a real CTR decline across the two windows flags fatigue even with modest frequency", () => {
  // Prior window (days 1-3): CTR = 40/1000 = 4%. Recent window (days 4-6): CTR = 10/1000 = 1%
  // — a 75% relative decline, comfortably past the 25% threshold.
  const metrics = [
    metric({ date: "2026-01-01", impressions: 1000, reach: 900, clicks: 40 }),
    metric({ date: "2026-01-02", impressions: 1000, reach: 900, clicks: 40 }),
    metric({ date: "2026-01-03", impressions: 1000, reach: 900, clicks: 40 }),
    metric({ date: "2026-01-04", impressions: 1000, reach: 900, clicks: 10 }),
    metric({ date: "2026-01-05", impressions: 1000, reach: 900, clicks: 10 }),
    metric({ date: "2026-01-06", impressions: 1000, reach: 900, clicks: 10 }),
  ];
  const result = computeFatigueScore(VARIANT_ID, metrics);
  assert.strictEqual(result.isFatigued, true);
  assert.ok(result.ctrDeclineRatio! > 0.25);
  assert.match(result.reason, /CTR down/);
});

test("computeFatigueScore - fewer than two full windows of history skips the CTR-trend signal without throwing", () => {
  const metrics = [
    metric({ date: "2026-01-01", impressions: 1000, reach: 900, clicks: 40 }),
    metric({ date: "2026-01-02", impressions: 1000, reach: 900, clicks: 10 }),
  ];
  const result = computeFatigueScore(VARIANT_ID, metrics);
  assert.strictEqual(result.priorCtr, null);
  assert.strictEqual(result.ctrDeclineRatio, null);
});

test("computeFatigueScore - only considers metric rows belonging to the requested variant", () => {
  const metrics = [
    metric({ variantId: "other-variant", impressions: 5000, reach: 1000 }),
    metric({ variantId: VARIANT_ID, impressions: 1000, reach: 950, clicks: 20 }),
  ];
  const result = computeFatigueScore(VARIANT_ID, metrics);
  assert.strictEqual(result.frequency, 1000 / 950);
  assert.strictEqual(result.isFatigued, false);
});
