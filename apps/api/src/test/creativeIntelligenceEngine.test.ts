import { test } from "node:test";
import assert from "node:assert";

delete process.env.OPENAI_API_KEY;

const t = Date.now();
const { runCreativeIntelligence } = await import(`../research/creative-intelligence/CreativeIntelligenceEngine.js?t=${t}`);

test("runCreativeIntelligence - with no OPENAI_API_KEY, degrades gracefully with zero network calls", async () => {
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  }) as typeof fetch;

  try {
    const report = await runCreativeIntelligence({
      workspaceId: "ws-1", url: "https://example.com", businessName: "Example Co",
      competitors: [{ name: "Rival Co" }, { name: "Other Co" }],
    });

    assert.strictEqual(report.competitors.length, 2);
    for (const c of report.competitors) {
      assert.strictEqual(c.citations.length, 0);
      assert.ok(c.confidence <= 0.2);
    }
    assert.ok(report.messagingGaps.length > 0);
    assert.ok(report.differentiationOpportunities.length > 0);
    assert.ok(report.creativeRecommendations.length > 0);
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = original;
  }
});

test("runCreativeIntelligence - caps analysis at 5 competitors even when more are supplied", async () => {
  const competitors = Array.from({ length: 8 }, (_, i) => ({ name: `Competitor ${i}` }));
  const report = await runCreativeIntelligence({ workspaceId: "ws-1", url: "https://example.com", competitors });
  assert.strictEqual(report.competitors.length, 5);
});
