import { test } from "node:test";
import assert from "node:assert";

delete process.env.OPENAI_API_KEY;

const t = Date.now();
const { runMarketIntelligence } = await import(`../research/market-intelligence/MarketIntelligenceEngine.js?t=${t}`);

test("runMarketIntelligence - with no OPENAI_API_KEY, degrades to a labeled low-confidence fallback with zero network calls", async () => {
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  }) as typeof fetch;

  try {
    const report = await runMarketIntelligence({ workspaceId: "ws-1", url: "https://example.com", businessName: "Example Co", industry: "widgets" });

    assert.ok(report.currentMarket.includes("Unknown"));
    assert.strictEqual(report.opportunityScore, 0);
    assert.strictEqual(report.citations.length, 0);
    assert.ok(report.confidence <= 0.2);
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = original;
  }
});
