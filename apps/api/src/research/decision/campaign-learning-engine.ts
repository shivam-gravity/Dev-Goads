import { normalizePerformance } from "../../modules/pipeline/performancePipeline.js";
import { getCampaignGenerationJobByCampaignId } from "../../modules/orchestrator/campaignGenerationService.js";
import { writeMemory } from "../memory/MemoryCoordinator.js";
import { recordRecommendationOutcomeAndPattern } from "./campaign-intelligence-store.js";
import type { NormalizedPerformance } from "../../types/index.js";

/**
 * Cross-Campaign Learning Engine — closes the loop ranking-engine.ts's historicalSuccessFor
 * was missing: that factor only ever remembered "was a similar recommendation *suggested*
 * before" (via decision-engine.ts's persistRecommendations, scored from the recommendation's
 * OWN research-grounding confidence at generation time — a self-referential signal, not an
 * outcome). This module is the other half: once a campaign built from a recommendation has
 * accumulated real performance data, it writes that REAL outcome back to Research Memory, so
 * the next campaign-generation run for this (or any) workspace scores similar recommendations
 * using what actually happened last time, not just what the research alone predicted.
 *
 * Every score here is code-computed from real ad performance — never an LLM self-report,
 * matching the deterministic-scoring principle the whole Decision Engine is built on.
 */

export const OUTCOME_MEMORY_KIND = "campaign-outcome";

// Same statistical-significance floor optimizationEngine.ts uses before trusting a
// variant's numbers enough to act on them — reused here so "enough data to learn from"
// means the same thing everywhere in the codebase.
const MIN_CONVERSIONS_FOR_OUTCOME = 5;

// Reference ceilings a metric needs to hit to fully max out its share of the outcome
// score. Deliberately generic paid-social/search benchmarks, not this account's own
// history (which doesn't exist yet for a first deploy) — documented here so they're easy
// to recalibrate later once real usage data exists across enough campaigns.
const CTR_CEILING = 0.05;
const CONVERSION_RATE_CEILING = 0.15;
const ROAS_CEILING = 4;

export interface CampaignOutcome {
  campaignId: string;
  /** 0-100, same scale as every other ranking factor in ranking-engine.ts. */
  outcomeScore: number;
  ctr: number;
  conversionRate: number;
  roas: number | null;
  totalConversions: number;
}

function aggregateOutcome(campaignId: string, stats: NormalizedPerformance[]): CampaignOutcome | null {
  const totalImpressions = stats.reduce((sum, v) => sum + v.impressions, 0);
  const totalClicks = stats.reduce((sum, v) => sum + v.clicks, 0);
  const totalConversions = stats.reduce((sum, v) => sum + v.conversions, 0);
  if (totalConversions < MIN_CONVERSIONS_FOR_OUTCOME) return null;

  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const conversionRate = totalClicks > 0 ? totalConversions / totalClicks : 0;
  const roasValues = stats.map((v) => v.roas).filter((r): r is number => r !== null);
  const roas = roasValues.length > 0 ? roasValues.reduce((sum, r) => sum + r, 0) / roasValues.length : null;

  const outcomeScore =
    Math.min(ctr / CTR_CEILING, 1) * 30 +
    Math.min(conversionRate / CONVERSION_RATE_CEILING, 1) * 50 +
    Math.min((roas ?? 0) / ROAS_CEILING, 1) * 20;

  return {
    campaignId,
    outcomeScore: Math.round(outcomeScore * 100) / 100,
    ctr: Math.round(ctr * 10000) / 10000,
    conversionRate: Math.round(conversionRate * 10000) / 10000,
    roas: roas === null ? null : Math.round(roas * 100) / 100,
    totalConversions,
  };
}

/**
 * Attributes a live campaign's real performance back to the recommendations that produced
 * it. Best-effort and idempotent (writeMemory dedupes on kind+workspaceId+dedupKey, so
 * calling this again for the same campaign just refreshes the score with fresher data
 * instead of accumulating duplicate entries) — safe to call on every metrics-ingestion
 * tick for every active campaign, not just once.
 *
 * Returns null (not an error) when there's not yet enough data to learn from, or when the
 * campaign wasn't built by this pipeline (e.g. the manual Campaign Builder flow) and so has
 * no originating recommendations to attribute an outcome to.
 */
export async function recordCampaignOutcome(campaignId: string): Promise<CampaignOutcome | null> {
  const stats = await normalizePerformance(campaignId);
  if (stats.length === 0) return null;

  const outcome = aggregateOutcome(campaignId, stats);
  if (!outcome) return null;

  const job = await getCampaignGenerationJobByCampaignId(campaignId);
  const decisionContext = job?.decisionContext;
  if (!job || !decisionContext) return outcome;

  await Promise.all(
    decisionContext.recommendations.map((recommendation) => {
      const dedupKey = `${campaignId}::${recommendation.category}::${recommendation.title.toLowerCase().slice(0, 80)}`;
      return writeMemory({
        workspaceId: job.workspaceId,
        businessId: job.businessId,
        kind: OUTCOME_MEMORY_KIND,
        sourceUrl: job.url,
        dedupKey,
        content: `${recommendation.category}: ${recommendation.title} — real campaign outcome: ${outcome.outcomeScore}/100 (CTR ${(outcome.ctr * 100).toFixed(2)}%, conversion rate ${(outcome.conversionRate * 100).toFixed(2)}%${outcome.roas !== null ? `, ROAS ${outcome.roas}x` : ""})`,
        metadata: {
          campaignId,
          outcomeScore: outcome.outcomeScore,
          ctr: outcome.ctr,
          conversionRate: outcome.conversionRate,
          roas: outcome.roas,
          totalConversions: outcome.totalConversions,
          category: recommendation.category,
        },
      }).catch(() => {
        // Research Memory is an enhancement (feeds future historicalSuccess scoring),
        // never a reason to fail the metrics-ingestion tick this runs alongside.
      });
    })
  );

  // Campaign Intelligence: advances the recommendations that fed this campaign from
  // "accepted" to "implemented" with a real effectiveness score, and — for whichever
  // networks are actually winning — strengthens a recurring SuccessPattern. Same
  // enhancement-only posture as the Research Memory writes above.
  await recordRecommendationOutcomeAndPattern({ campaignId, job, outcome }).catch(() => {});

  return outcome;
}
