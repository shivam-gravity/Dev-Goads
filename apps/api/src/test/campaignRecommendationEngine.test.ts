import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import {
  assembleCampaignRecommendations,
  generateAndPersistCampaignRecommendations,
  getCampaignRecommendations,
  type AssembleCampaignRecommendationsInput,
} from "../research/campaign-recommendation/CampaignRecommendationEngine.js";
import type { CampaignStrategy, DecisionContext, StrategySimulationResult } from "../research/decision/types.js";
import type { AdCreative } from "../types/index.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

function fakeStrategy(overrides: Partial<CampaignStrategy> = {}): CampaignStrategy {
  return {
    id: randomUUID(), label: "Strategy A", targetAudience: "SMB owners", platforms: ["meta"],
    objective: "Lead generation", budgetDailyCents: 5000, creativeDirection: "Direct response",
    messaging: "Save time", offer: "Free trial", expectedKpi: "CPA < $50",
    strengths: [], weaknesses: [], confidence: 0.7,
    ...overrides,
  };
}

function fakeSimulation(strategyId: string, rank: number, overallScore: number): StrategySimulationResult {
  return { strategyId, strategyLabel: "Strategy", reach: 50, competition: 50, expectedRoi: 60, risk: 30, confidence: 0.7, budgetEfficiency: 60, overallScore, rank };
}

function fakeCreative(headline: string): AdCreative {
  return { headline, body: `Body for ${headline}`, callToAction: "Learn More" };
}

test("assembleCampaignRecommendations - returns exactly 6 packages, ranked so rank correlates with confidenceScore descending", () => {
  const strategies = [fakeStrategy({ id: "s1", label: "Strategy A" }), fakeStrategy({ id: "s2", label: "Strategy B" }), fakeStrategy({ id: "s3", label: "Strategy C" })];
  const simulations = [fakeSimulation("s1", 1, 90), fakeSimulation("s2", 2, 70), fakeSimulation("s3", 3, 40)];
  const creatives = [fakeCreative("Angle 1"), fakeCreative("Angle 2")];

  const packages = assembleCampaignRecommendations({ strategies, simulations, campaignAgentCreatives: creatives, landingPageRecommendation: "Add a testimonial above the fold." });

  assert.strictEqual(packages.length, 6);
  assert.deepStrictEqual(packages.map((p) => p.rank), [1, 2, 3, 4, 5, 6]);
  for (let i = 1; i < packages.length; i++) {
    assert.ok(packages[i - 1]!.confidenceScore >= packages[i]!.confidenceScore, "rank must correlate with descending confidenceScore");
  }
  assert.strictEqual(packages[0]!.landingPageRecommendation, "Add a testimonial above the fold.");
});

test("assembleCampaignRecommendations - every recommendation's strategy is represented, using real creative content", () => {
  const strategies = [fakeStrategy({ id: "s1", label: "Strategy A" }), fakeStrategy({ id: "s2", label: "Strategy B" }), fakeStrategy({ id: "s3", label: "Strategy C" })];
  const simulations = [fakeSimulation("s1", 1, 90), fakeSimulation("s2", 2, 70), fakeSimulation("s3", 3, 40)];
  const creatives = [fakeCreative("Angle 1")];

  const packages = assembleCampaignRecommendations({ strategies, simulations, campaignAgentCreatives: creatives, landingPageRecommendation: "n/a" });
  const objectives = new Set(packages.map((p) => p.objective));
  assert.strictEqual(objectives.size, 1, "all 3 fakeStrategy() fixtures share the same objective in this test — sanity check for the assertion below");
  for (const pkg of packages) {
    assert.strictEqual(pkg.headlines[0], "Angle 1");
    assert.strictEqual(pkg.primaryText, "Body for Angle 1");
  }
});

test("assembleCampaignRecommendations - degrades to a single generic creative (never throws) when the Campaign Agent produced none", () => {
  const strategies = [fakeStrategy({ id: "s1" })];
  const packages = assembleCampaignRecommendations({ strategies, simulations: [fakeSimulation("s1", 1, 80)], campaignAgentCreatives: [], landingPageRecommendation: "n/a" });
  assert.strictEqual(packages.length, 6);
  assert.ok(packages.every((p) => p.headlines[0].length > 0));
});

test("assembleCampaignRecommendations - returns an empty array (not a throw) when there are zero strategies", () => {
  assert.deepStrictEqual(assembleCampaignRecommendations({ strategies: [], simulations: [], campaignAgentCreatives: [], landingPageRecommendation: "n/a" } as AssembleCampaignRecommendationsInput), []);
});

function fakeDecisionContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    businessSummary: "n/a", audiencePersonas: [], topOpportunities: [], topRisks: [],
    pricingTiers: [], notableCustomers: [], quantifiedProofPoints: [], regionalMarketDepth: null,
    recommendedPositioning: "n/a", recommendedAudiencePriority: "n/a", recommendedChannels: [],
    recommendedBudgetAllocation: {}, recommendedDailyBudgetCents: 0, budgetReasoning: [],
    recommendedCreativeDirection: "n/a", recommendedOffer: "n/a", recommendedMessaging: "n/a",
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] }, marketGaps: [], funnelStrategy: "n/a", mediaStrategy: "n/a",
    confidence: 0.5, evidence: [], tradeoffs: [], recommendations: [], tradeoffAnalyses: [], explainability: [],
    strategies: [fakeStrategy({ id: "s1" })], simulations: [fakeSimulation("s1", 1, 80)],
    generatedAt: "now",
    ...overrides,
  };
}

async function createFixtureJob(): Promise<{ businessId: string; jobId: string }> {
  const businessId = randomUUID();
  const jobId = randomUUID();
  await prisma.business.create({ data: { id: businessId, data: { id: businessId, name: "Fixture Co" } as any } });
  await prisma.campaignGenerationJob.create({ data: { id: jobId, workspaceId: randomUUID(), businessId, url: "https://example.com" } });
  return { businessId, jobId };
}

async function cleanup(businessId: string, jobId: string): Promise<void> {
  await prisma.campaignRecommendation.deleteMany({ where: { campaignGenerationJobId: jobId } });
  await prisma.campaignGenerationJob.delete({ where: { id: jobId } }).catch(() => {});
  await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
}

test("generateAndPersistCampaignRecommendations - persists 6 rows readable back via getCampaignRecommendations", async () => {
  const { businessId, jobId } = await createFixtureJob();
  try {
    const count = await generateAndPersistCampaignRecommendations(jobId, fakeDecisionContext(), [fakeCreative("Real Headline")], "Simplify the checkout form.");
    assert.strictEqual(count, 6);

    const recs = await getCampaignRecommendations(jobId);
    assert.strictEqual(recs.length, 6);
    assert.deepStrictEqual(recs.map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
    assert.strictEqual(recs[0]!.landingPageRecommendation, "Simplify the checkout form.");
  } finally {
    await cleanup(businessId, jobId);
  }
});

test("generateAndPersistCampaignRecommendations - a re-run replaces the prior recommendations rather than duplicating them", async () => {
  const { businessId, jobId } = await createFixtureJob();
  try {
    await generateAndPersistCampaignRecommendations(jobId, fakeDecisionContext(), [fakeCreative("First Run")], "n/a");
    await generateAndPersistCampaignRecommendations(jobId, fakeDecisionContext(), [fakeCreative("Second Run")], "n/a");

    const recs = await getCampaignRecommendations(jobId);
    assert.strictEqual(recs.length, 6, "must not accumulate 12 rows across two runs");
    assert.strictEqual(recs[0]!.headlines[0], "Second Run");
  } finally {
    await cleanup(businessId, jobId);
  }
});

test("generateAndPersistCampaignRecommendations - returns 0 and persists nothing when decisionContext is null (Decision Engine failed)", async () => {
  const { businessId, jobId } = await createFixtureJob();
  try {
    const count = await generateAndPersistCampaignRecommendations(jobId, null, [fakeCreative("X")], "n/a");
    assert.strictEqual(count, 0);
    assert.deepStrictEqual(await getCampaignRecommendations(jobId), []);
  } finally {
    await cleanup(businessId, jobId);
  }
});
