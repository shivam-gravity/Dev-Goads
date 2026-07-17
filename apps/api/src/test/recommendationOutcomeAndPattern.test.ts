import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";
import { recordRecommendationOutcomeAndPattern, recordRecommendationDecisions } from "../research/decision/campaign-intelligence-store.js";
import {
  createCampaignGenerationJob, persistDecisionContext, markCampaignGenerationCompleted, getCampaignGenerationJobByCampaignId,
} from "../modules/orchestrator/campaignGenerationService.js";
import type { DecisionContext, RankedRecommendation } from "../research/decision/types.js";

for (const key of [
  "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID",
  "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_ACCESS_TOKEN",
  "TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID",
]) delete process.env[key];

const { buildCampaignFromStrategy } = await import("../modules/orchestrator/campaignOrchestrator.js");

after(disconnectTestInfra);

const RANKING_FACTORS = {
  researchConfidence: 0.8, evidenceQuality: 0.8, sourceAuthority: 0.8,
  freshness: 0.8, businessRelevance: 0.8, crossProviderAgreement: 0.8, historicalSuccess: 0.5,
};

function fakeRecommendation(i: number): RankedRecommendation {
  return {
    id: `rec-${i}`, title: `Recommendation ${i}`, category: "audience", priority: "medium", impact: "medium",
    confidence: 0.7, reason: "test", evidence: ["test"], affectedAudience: "everyone", estimatedDifficulty: "low",
    expectedOutcome: "more conversions", rankingFactors: RANKING_FACTORS, finalScore: 100 - i,
  };
}

async function setupCampaignWithJob(businessId: string, workspaceId: string) {
  const strategyId = `strat_outcome_test_${Date.now()}_${Math.random()}`;
  const strategyData = {
    id: strategyId, businessId, summary: "Outcome test strategy", recommendedNetworks: ["meta", "google"],
    budgetSplit: { meta: 0.5, google: 0.5 }, audiences: ["Winning Audience"],
    creatives: [{ headline: "Winning Creative", body: "Body", callToAction: "Shop Now" }], createdAt: new Date().toISOString(),
  };
  await prisma.strategy.create({ data: { id: strategyId, businessId, data: strategyData, createdAt: new Date() } });
  const campaign = await buildCampaignFromStrategy(strategyId, "Outcome Test Campaign", 5000);

  const decisionContext = {
    recommendedAudiencePriority: "Winning Audience",
    recommendedOffer: "20% off first order",
    recommendations: [fakeRecommendation(0), fakeRecommendation(1)],
  } as unknown as DecisionContext;

  const job = await createCampaignGenerationJob({ workspaceId, businessId, url: "https://example.com" });
  await persistDecisionContext(job.id, decisionContext);
  await markCampaignGenerationCompleted(job.id, campaign.id);

  await recordRecommendationDecisions({ workspaceId, businessId, campaignId: campaign.id, decisionContext });

  return { campaign, decisionContext, workspaceId, businessId };
}

async function seedSnapshot(campaignId: string, workspaceId: string, businessId: string, networkBreakdown: unknown) {
  await prisma.campaignPerformanceSnapshot.create({
    data: {
      id: randomUUID(), campaignId, workspaceId, businessId,
      impressions: 10000, clicks: 500, conversions: 50, spendCents: 20000, revenueCents: 250000, ctr: 0.05,
      metadata: { networkBreakdown } as any,
    },
  });
}

test("recordRecommendationOutcomeAndPattern - advances accepted feedback to implemented with a real effectiveness score", async () => {
  const businessId = `biz-outcome-${Date.now()}`;
  const workspaceId = `ws-outcome-${Date.now()}`;
  const { campaign } = await setupCampaignWithJob(businessId, workspaceId);
  await seedSnapshot(campaign.id, workspaceId, businessId, []);

  const jobRecord = await getCampaignGenerationJobByCampaignId(campaign.id);
  assert.ok(jobRecord, "expected the generation job to be findable by its resulting campaignId");
  const outcome = { outcomeScore: 82.5, ctr: 0.05, conversionRate: 0.1, roas: 3, totalConversions: 50 };
  await recordRecommendationOutcomeAndPattern({ campaignId: campaign.id, job: jobRecord!, outcome });

  const rows = await prisma.recommendationFeedback.findMany({ where: { campaignId: campaign.id } });
  assert.strictEqual(rows.length, 2);
  for (const row of rows) {
    assert.strictEqual(row.status, "implemented");
    assert.strictEqual(row.effectivenessScore, 0.825);
    assert.match(row.outcomeSummary ?? "", /82\.5\/100/);
  }
});

test("recordRecommendationOutcomeAndPattern - upserts a SuccessPattern only for networks that clear the winning ROAS threshold", async () => {
  const businessId = `biz-pattern-${Date.now()}`;
  const workspaceId = `ws-pattern-${Date.now()}`;
  const { campaign } = await setupCampaignWithJob(businessId, workspaceId);
  await seedSnapshot(campaign.id, workspaceId, businessId, [
    { network: "meta", impressions: 5000, clicks: 300, conversions: 30, spendCents: 10000, ctr: 0.06, roas: 4 }, // clears 2x threshold
    { network: "google", impressions: 5000, clicks: 200, conversions: 4, spendCents: 10000, ctr: 0.04, roas: 1.2 }, // below threshold
  ]);

  const jobRecord = await getCampaignGenerationJobByCampaignId(campaign.id);
  assert.ok(jobRecord, "expected the generation job to be findable by its resulting campaignId");
  const outcome = { outcomeScore: 70, ctr: 0.05, conversionRate: 0.08, roas: 2.5, totalConversions: 34 };
  await recordRecommendationOutcomeAndPattern({ campaignId: campaign.id, job: jobRecord!, outcome });

  const patterns = await prisma.successPattern.findMany({ where: { workspaceId } });
  assert.strictEqual(patterns.length, 1, "only the meta network cleared the winning threshold");
  const pattern = patterns[0];
  assert.strictEqual(pattern.platform, "meta");
  assert.strictEqual(pattern.audience, "Winning Audience");
  assert.strictEqual(pattern.creative, "Winning Creative");
  assert.strictEqual(pattern.offer, "20% off first order");
  assert.strictEqual(pattern.occurrences, 1);
  assert.strictEqual(pattern.avgRoas, 4);
});

test("recordRecommendationOutcomeAndPattern - a second winning outcome strengthens the existing pattern instead of duplicating it", async () => {
  const businessId = `biz-pattern2-${Date.now()}`;
  const workspaceId = `ws-pattern2-${Date.now()}`;
  const { campaign } = await setupCampaignWithJob(businessId, workspaceId);
  const breakdown = [{ network: "meta", impressions: 5000, clicks: 300, conversions: 30, spendCents: 10000, ctr: 0.06, roas: 4 }];
  await seedSnapshot(campaign.id, workspaceId, businessId, breakdown);

  const jobRecord = await getCampaignGenerationJobByCampaignId(campaign.id);
  assert.ok(jobRecord, "expected the generation job to be findable by its resulting campaignId");
  const outcome = { outcomeScore: 70, ctr: 0.05, conversionRate: 0.08, roas: 2.5, totalConversions: 34 };
  await recordRecommendationOutcomeAndPattern({ campaignId: campaign.id, job: jobRecord!, outcome });
  await recordRecommendationOutcomeAndPattern({ campaignId: campaign.id, job: jobRecord!, outcome });

  const patterns = await prisma.successPattern.findMany({ where: { workspaceId } });
  assert.strictEqual(patterns.length, 1, "same audience/creative/offer/platform combination must not duplicate");
  assert.strictEqual(patterns[0].occurrences, 2);
  assert.strictEqual(patterns[0].confidence, 0.2, "2 occurrences / 10");
});
