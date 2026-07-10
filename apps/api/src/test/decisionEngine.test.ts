import { test } from "node:test";
import assert from "node:assert";
import type { ResearchContext } from "../research/types/index.js";

function fakeContext(overrides: Partial<ResearchContext> = {}): ResearchContext {
  return {
    jobId: "research-1", workspaceId: "ws-1", url: "https://example.com",
    website: null, market: null, technology: null, competitors: null, keywords: null, audience: null, company: null, news: null,
    metadata: { jobId: "research-1", generatedAt: new Date().toISOString(), totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
    ...overrides,
  };
}

delete process.env.OPENAI_API_KEY;
const t = Date.now();
const { runDecisionEngine } = await import(`../research/decision/decision-engine.js?t=${t}`);

test("runDecisionEngine - with no OPENAI_API_KEY, still returns a fully-shaped DecisionContext with zero network calls", async () => {
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => { fetchCalled = true; throw new Error("should not be called"); }) as typeof fetch;

  try {
    const decision = await runDecisionEngine(fakeContext());
    for (const key of [
      "businessSummary", "topOpportunities", "topRisks", "recommendedPositioning", "recommendedAudiencePriority",
      "recommendedChannels", "recommendedBudgetAllocation", "recommendedDailyBudgetCents", "budgetReasoning",
      "recommendedCreativeDirection", "recommendedOffer", "pricingTiers", "notableCustomers", "quantifiedProofPoints",
      "regionalMarketDepth", "recommendedMessaging", "confidence", "evidence", "tradeoffs", "recommendations",
      "tradeoffAnalyses", "explainability", "strategies", "simulations", "generatedAt",
    ]) {
      assert.ok(key in decision, `missing top-level field ${key}`);
    }
    assert.strictEqual(decision.strategies.length, 3);
    assert.strictEqual(decision.recommendations.length, decision.tradeoffAnalyses.length);
    assert.strictEqual(decision.recommendations.length, decision.explainability.length);
    assert.strictEqual(decision.simulations.length, 3);
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = original;
  }
});

test("runDecisionEngine - recommendations arrive pre-ranked (descending finalScore) and every simulation references a real strategy id", async () => {
  const decision = await runDecisionEngine(fakeContext());
  for (let i = 1; i < decision.recommendations.length; i++) {
    assert.ok(decision.recommendations[i - 1].finalScore >= decision.recommendations[i].finalScore);
  }
  const strategyIds = new Set(decision.strategies.map((s: { id: string }) => s.id));
  for (const sim of decision.simulations) {
    assert.ok(strategyIds.has(sim.strategyId));
  }
});

test("runDecisionEngine - recommendedChannels/recommendedBudgetAllocation come from the top-ranked (rank 1) simulated strategy", async () => {
  const decision = await runDecisionEngine(fakeContext());
  const winner = decision.simulations.find((s: { rank: number }) => s.rank === 1);
  const winningStrategy = decision.strategies.find((s: { id: string }) => s.id === winner!.strategyId);
  assert.deepStrictEqual(decision.recommendedChannels, winningStrategy!.platforms);
  const allocationSum = Object.values(decision.recommendedBudgetAllocation as Record<string, number>).reduce((sum, v) => sum + v, 0);
  assert.ok(Math.abs(allocationSum - 1) < 0.01 || winningStrategy!.platforms.length === 0);
});

test("runDecisionEngine - recommendedDailyBudgetCents matches the winning strategy's own budget, and budgetReasoning cites its actual scores", async () => {
  const decision = await runDecisionEngine(fakeContext());
  const winner = decision.simulations.find((s: { rank: number }) => s.rank === 1);
  const winningStrategy = decision.strategies.find((s: { id: string }) => s.id === winner!.strategyId);
  assert.strictEqual(decision.recommendedDailyBudgetCents, winningStrategy!.budgetDailyCents);
  assert.ok(decision.budgetReasoning.length > 0);
  assert.ok(decision.budgetReasoning.some((line: string) => line.includes(winningStrategy!.label)));
});

test("runDecisionEngine - enrichment fields (pricing/customers/proof points/regional depth) are always present, even without an API key", async () => {
  const decision = await runDecisionEngine(fakeContext());
  assert.deepStrictEqual(decision.pricingTiers, []);
  assert.deepStrictEqual(decision.notableCustomers, []);
  assert.deepStrictEqual(decision.quantifiedProofPoints, []);
  assert.strictEqual(decision.regionalMarketDepth, null);
});

test("runDecisionEngine - websiteScreenshot passes through context.website.screenshot unchanged, and is undefined when there's none", async () => {
  const withScreenshot = await runDecisionEngine(fakeContext({
    website: { title: "t", description: "d", excerpt: "e", images: [], crawledPages: [], pagesDiscovered: 1, screenshot: "data:image/png;base64,abc", dataSource: "test" },
  }));
  assert.strictEqual(withScreenshot.websiteScreenshot, "data:image/png;base64,abc");

  const without = await runDecisionEngine(fakeContext());
  assert.strictEqual(without.websiteScreenshot, undefined);
});

test("runDecisionEngine - audiencePersonas is derived directly from ResearchContext.audience.segments, and empty when there's no audience data", async () => {
  const withAudience = await runDecisionEngine(fakeContext({
    audience: {
      primaryAudience: "Buyers", dataSource: "test",
      segments: [{ name: "Enterprise IT Leaders", description: "CTOs evaluating vendors" }, { name: "Ops Managers", description: "Day-to-day operators" }],
      painPoints: [], interestTags: ["SaaS", "Cloud", "Security"],
      demographics: { ageDistribution: "30-50", genderRatio: "60% Male, 40% Female" },
    },
  }));
  assert.strictEqual(withAudience.audiencePersonas.length, 2);
  assert.strictEqual(withAudience.audiencePersonas[0].name, "Enterprise IT Leaders");
  assert.strictEqual(withAudience.audiencePersonas[0].ageRange, "30-50");
  assert.deepStrictEqual(withAudience.audiencePersonas[0].interests, ["SaaS", "Cloud", "Security"]);

  const without = await runDecisionEngine(fakeContext());
  assert.deepStrictEqual(without.audiencePersonas, []);
});
