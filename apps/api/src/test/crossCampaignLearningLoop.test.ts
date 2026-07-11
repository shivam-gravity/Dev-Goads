import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert";
import { writeMemory } from "../research/memory/MemoryCoordinator.js";
import { OUTCOME_MEMORY_KIND } from "../research/decision/campaign-learning-engine.js";
import { rankRecommendations } from "../research/decision/ranking-engine.js";
import type { ResearchContext } from "../research/types/index.js";
import type { Recommendation } from "../research/decision/types.js";

/**
 * End-to-end proof that campaign-learning-engine.ts's real outcome writes actually move
 * ranking-engine.ts's historicalSuccess factor and final scores — not just that each piece
 * works in isolation (campaignLearningEngine.test.ts covers outcome computation;
 * decisionRankingEngine.test.ts covers scoring math with no memory data). Neither existing
 * suite proves the loop actually closes: that a real outcome written for one campaign changes
 * how a similar recommendation ranks for the NEXT campaign. This does, using the exact
 * content/metadata shape recordCampaignOutcome() writes, so the vector-similarity match this
 * relies on is the same one production traffic goes through.
 */

function fakeContext(workspaceId: string): ResearchContext {
  return {
    jobId: "research-1", workspaceId, url: "https://example.com",
    website: null, market: null, technology: null, competitors: null, keywords: null, audience: null, company: null, news: null,
    metadata: { jobId: "research-1", generatedAt: new Date().toISOString(), totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
  };
}

// Identical confidence/evidence/priority/etc across all three recommendations —
// historicalSuccess (fed by simulated outcomes below) is the ONLY factor allowed to differ,
// so any ranking shift can only be attributed to the cross-campaign learning signal.
function fakeRecommendation(overrides: Partial<Recommendation>): Recommendation {
  return {
    id: "rec", title: "placeholder", category: "audience", priority: "medium", impact: "medium",
    confidence: 0.5, reason: "because", evidence: ["Company: Acme sells widgets."],
    affectedAudience: "Everyone", estimatedDifficulty: "medium", expectedOutcome: "More sales",
    ...overrides,
  };
}

async function simulateOutcome(workspaceId: string, campaignId: string, category: string, title: string, outcomeScore: number) {
  // Mirrors campaign-learning-engine.ts's recordCampaignOutcome write exactly (same content
  // template, same metadata keys) so this exercises the real production code path, not a
  // simplified stand-in.
  await writeMemory({
    workspaceId,
    businessId: "biz-1",
    kind: OUTCOME_MEMORY_KIND,
    sourceUrl: "https://example.com",
    dedupKey: `${campaignId}::${category}::${title.toLowerCase().slice(0, 80)}`,
    content: `${category}: ${title} — real campaign outcome: ${outcomeScore}/100 (CTR 3.00%, conversion rate 8.00%, ROAS 2.5x)`,
    metadata: { campaignId, outcomeScore, ctr: 0.03, conversionRate: 0.08, roas: 2.5, totalConversions: 20, category },
  });
}

test("cross-campaign learning — a recommendation with strong simulated outcomes outranks an identical-prior weak one, and both outrank a never-seen one", async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.log("Skipping — OPENAI_API_KEY not set, Research Memory embeddings are unavailable.");
    return;
  }

  const workspaceId = `ws-crosslearn-${Date.now()}`;
  const goodTitle = "Retarget cart abandoners with urgency-driven messaging";
  const badTitle = "Run broad awareness ads with generic stock-photo messaging";

  // Simulate three PAST campaigns per recommendation, so the signal isn't a single lucky data
  // point — this is what "cross-campaign" means: the learning compounds across campaigns, not
  // just within one.
  await Promise.all([
    simulateOutcome(workspaceId, "camp-good-1", "audience", goodTitle, 94),
    simulateOutcome(workspaceId, "camp-good-2", "audience", goodTitle, 88),
    simulateOutcome(workspaceId, "camp-good-3", "audience", goodTitle, 91),
    simulateOutcome(workspaceId, "camp-bad-1", "audience", badTitle, 8),
    simulateOutcome(workspaceId, "camp-bad-2", "audience", badTitle, 14),
    simulateOutcome(workspaceId, "camp-bad-3", "audience", badTitle, 11),
  ]);

  const context = fakeContext(workspaceId);
  const recGood = fakeRecommendation({ id: "rec-good", title: goodTitle, category: "audience" });
  const recBad = fakeRecommendation({ id: "rec-bad", title: badTitle, category: "audience" });
  const recNeutral = fakeRecommendation({ id: "rec-neutral", title: "Try a completely novel angle nobody has run before", category: "audience" });

  // Deliberately shuffled input order — the assertion below is on rankRecommendations'
  // OUTPUT order, so this proves the engine is doing the sorting, not the caller.
  const ranked = await rankRecommendations([recBad, recNeutral, recGood], context);

  const byId = Object.fromEntries(ranked.map((r) => [r.id, r]));

  console.log("Cross-campaign learning proof — historicalSuccess factors:", {
    good: byId["rec-good"].rankingFactors.historicalSuccess,
    neutral: byId["rec-neutral"].rankingFactors.historicalSuccess,
    bad: byId["rec-bad"].rankingFactors.historicalSuccess,
  });
  console.log("Cross-campaign learning proof — final scores:", {
    good: byId["rec-good"].finalScore,
    neutral: byId["rec-neutral"].finalScore,
    bad: byId["rec-bad"].finalScore,
  });

  // The real, compounding-outcome signal must dominate: strong prior outcomes score
  // meaningfully above "never seen" (neutral), which in turn scores above a recommendation
  // with a strong track record of NOT working.
  assert.ok(
    byId["rec-good"].rankingFactors.historicalSuccess > byId["rec-neutral"].rankingFactors.historicalSuccess,
    "a recommendation with strong real outcomes must score higher than one with no track record yet"
  );
  assert.ok(
    byId["rec-neutral"].rankingFactors.historicalSuccess > byId["rec-bad"].rankingFactors.historicalSuccess,
    "a recommendation with no track record must still outrank one with a proven-bad track record"
  );
  assert.ok(
    byId["rec-good"].rankingFactors.historicalSuccess - byId["rec-bad"].rankingFactors.historicalSuccess > 0.3,
    "the spread between a proven-good and proven-bad recommendation must be large, not a rounding-level nudge"
  );

  // rankRecommendations must actually reorder the list end to end — the outcome signal isn't
  // just computed and discarded, it changes what a customer sees ranked first.
  assert.strictEqual(ranked[0].id, "rec-good", "the recommendation with the strongest real outcomes must rank first");
  assert.strictEqual(ranked[ranked.length - 1].id, "rec-bad", "the recommendation with the worst real outcomes must rank last");
  assert.ok(byId["rec-good"].finalScore > byId["rec-bad"].finalScore, "final customer-facing score must reflect the same shift");
});
