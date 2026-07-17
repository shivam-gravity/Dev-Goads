import { test } from "node:test";
import assert from "node:assert";
import { computeLtvProxy } from "../research/audience-intelligence/ltvProxy.js";

test("computeLtvProxy - no real data anywhere returns insufficient-data with a zero score, never a fabricated number", () => {
  const result = computeLtvProxy({});
  assert.strictEqual(result.estimatedOrderValueCents, null);
  assert.strictEqual(result.conversionRateSignal, null);
  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.basis, "insufficient-data");
});

test("computeLtvProxy - catalog data only produces a real order-value-based score, basis 'catalog-only'", () => {
  const result = computeLtvProxy({ catalogAverageOrderValueCents: 10000 });
  assert.strictEqual(result.estimatedOrderValueCents, 10000);
  assert.strictEqual(result.conversionRateSignal, null);
  assert.strictEqual(result.basis, "catalog-only");
  assert.ok(result.score > 0);
});

test("computeLtvProxy - conversion-rate data only produces a real score, basis 'campaign-history-only'", () => {
  const result = computeLtvProxy({ historicalConversionRate: 0.1 });
  assert.strictEqual(result.estimatedOrderValueCents, null);
  assert.strictEqual(result.conversionRateSignal, 0.1);
  assert.strictEqual(result.basis, "campaign-history-only");
  assert.ok(result.score > 0);
});

test("computeLtvProxy - both signals present combine into a higher score than either alone, basis 'catalog+campaign-history'", () => {
  const both = computeLtvProxy({ catalogAverageOrderValueCents: 10000, historicalConversionRate: 0.1 });
  const catalogOnly = computeLtvProxy({ catalogAverageOrderValueCents: 10000 });
  const conversionOnly = computeLtvProxy({ historicalConversionRate: 0.1 });

  assert.strictEqual(both.basis, "catalog+campaign-history");
  assert.ok(both.score > catalogOnly.score);
  assert.ok(both.score > conversionOnly.score);
});

test("computeLtvProxy - order value is capped at 100% of its weight component beyond the ceiling, never exceeding the max possible score", () => {
  const belowCeiling = computeLtvProxy({ catalogAverageOrderValueCents: 20000 });
  const wayAboveCeiling = computeLtvProxy({ catalogAverageOrderValueCents: 500000 });
  assert.strictEqual(belowCeiling.score, wayAboveCeiling.score, "a $5000 order value shouldn't score higher than a $200 one — both are at the ceiling");
  assert.ok(wayAboveCeiling.score <= 100);
});

test("computeLtvProxy - a maxed-out combination never exceeds a 100 score", () => {
  const maxed = computeLtvProxy({ catalogAverageOrderValueCents: 1_000_000, historicalConversionRate: 1 });
  assert.ok(maxed.score <= 100, `expected score <= 100, got ${maxed.score}`);
});

test("computeLtvProxy - zero or negative inputs are treated the same as missing data, not as a real zero signal", () => {
  const zero = computeLtvProxy({ catalogAverageOrderValueCents: 0, historicalConversionRate: 0 });
  assert.strictEqual(zero.basis, "insufficient-data");
});
