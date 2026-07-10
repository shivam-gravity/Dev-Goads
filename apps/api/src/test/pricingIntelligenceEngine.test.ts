import { test } from "node:test";
import assert from "node:assert";
import { computePosition, median } from "../research/pricing-intelligence/PricingIntelligenceEngine.js";

test("median - odd-length array returns the middle value", () => {
  assert.strictEqual(median([10, 30, 20]), 20);
});

test("median - even-length array averages the two middle values", () => {
  assert.strictEqual(median([10, 20, 30, 40]), 25);
});

test("median - empty array returns null", () => {
  assert.strictEqual(median([]), null);
});

test("computePosition - below the entire competitor range", () => {
  assert.strictEqual(computePosition(10, [50, 60, 70]), "below-range");
});

test("computePosition - above the entire competitor range", () => {
  assert.strictEqual(computePosition(100, [50, 60, 70]), "above-range");
});

test("computePosition - low end, mid-range, and high end within the range", () => {
  assert.strictEqual(computePosition(51, [50, 100]), "low-end");
  assert.strictEqual(computePosition(75, [50, 100]), "mid-range");
  assert.strictEqual(computePosition(99, [50, 100]), "high-end");
});

test("computePosition - unknown when the company's price or competitor prices are missing", () => {
  assert.strictEqual(computePosition(null, [50, 100]), "unknown");
  assert.strictEqual(computePosition(50, []), "unknown");
});

delete process.env.OPENAI_API_KEY;
const t = Date.now();
const { runPricingIntelligence } = await import(`../research/pricing-intelligence/PricingIntelligenceEngine.js?t=${t}`);

test("runPricingIntelligence - with no OPENAI_API_KEY, degrades gracefully with zero network calls", async () => {
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  }) as typeof fetch;

  try {
    const report = await runPricingIntelligence({
      workspaceId: "ws-1", url: "https://example.com", businessName: "Example Co",
      competitors: [{ name: "Rival Co" }],
    });

    assert.strictEqual(report.company.startingPriceUsd, null);
    assert.strictEqual(report.median, null);
    assert.strictEqual(report.range, null);
    assert.strictEqual(report.position, "unknown");
    assert.ok(report.recommendations.length > 0);
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = original;
  }
});
