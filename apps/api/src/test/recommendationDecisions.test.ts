import { test, after } from "node:test";
import assert from "node:assert";
import { prisma } from "../db/prisma.js";
import { recordRecommendationDecisions } from "../research/decision/campaign-intelligence-store.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";
import type { DecisionContext, RankedRecommendation } from "../research/decision/types.js";

after(disconnectTestInfra);

const RANKING_FACTORS = {
  researchConfidence: 0.8, evidenceQuality: 0.8, sourceAuthority: 0.8,
  freshness: 0.8, businessRelevance: 0.8, crossProviderAgreement: 0.8, historicalSuccess: 0.5,
};

function fakeRecommendation(i: number): RankedRecommendation {
  return {
    id: `rec-${i}`,
    title: `Recommendation number ${i}`,
    category: "audience",
    priority: "medium",
    impact: "medium",
    confidence: 0.7,
    reason: "test reason",
    evidence: ["test evidence"],
    affectedAudience: "everyone",
    estimatedDifficulty: "low",
    expectedOutcome: "more conversions",
    rankingFactors: RANKING_FACTORS,
    finalScore: 100 - i, // descending, so rec-0 ranks highest
  };
}

test("recordRecommendationDecisions - top 5 ranked recommendations are accepted, the rest are ignored", async () => {
  const workspaceId = `ws-reco-${Date.now()}`;
  const businessId = `biz-reco-${Date.now()}`;
  const campaignId = `camp-reco-${Date.now()}`;
  const recommendations = Array.from({ length: 7 }, (_, i) => fakeRecommendation(i));
  const decisionContext = { recommendations } as unknown as DecisionContext;

  await recordRecommendationDecisions({ workspaceId, businessId, campaignId, decisionContext });

  const rows = await prisma.recommendationFeedback.findMany({ where: { workspaceId, campaignId } });
  assert.strictEqual(rows.length, 7);
  for (let i = 0; i < 5; i++) {
    const row = rows.find((r) => r.title === `Recommendation number ${i}`);
    assert.strictEqual(row?.status, "accepted", `recommendation ${i} is in the top 5 and should be accepted`);
  }
  for (let i = 5; i < 7; i++) {
    const row = rows.find((r) => r.title === `Recommendation number ${i}`);
    assert.strictEqual(row?.status, "ignored", `recommendation ${i} is outside the top 5 and should be ignored`);
  }
});

test("recordRecommendationDecisions - calling twice for the same campaign updates in place rather than duplicating rows", async () => {
  const workspaceId = `ws-reco-idem-${Date.now()}`;
  const businessId = `biz-reco-idem-${Date.now()}`;
  const campaignId = `camp-reco-idem-${Date.now()}`;
  const recommendations = Array.from({ length: 3 }, (_, i) => fakeRecommendation(i));
  const decisionContext = { recommendations } as unknown as DecisionContext;

  await recordRecommendationDecisions({ workspaceId, businessId, campaignId, decisionContext });
  await recordRecommendationDecisions({ workspaceId, businessId, campaignId, decisionContext });

  const rows = await prisma.recommendationFeedback.findMany({ where: { workspaceId, campaignId } });
  assert.strictEqual(rows.length, 3, "no duplicate rows should be created on a second call");
});
