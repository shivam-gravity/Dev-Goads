import { normalizePerformance } from "../pipeline/performancePipeline.js";
import { getCampaign, pauseVariant, reallocateBudget } from "../orchestrator/campaignOrchestrator.js";
import type { NormalizedPerformance, OptimizationDecision } from "../../types/index.js";

const EPSILON = 0.1; // exploration rate for epsilon-greedy allocation
const MIN_CONVERSIONS_FOR_CONFIDENCE = 5;
const MAX_CPA_MULTIPLIER = 2.5; // pause a variant once its CPA exceeds this multiple of the cohort's best CPA

function score(v: NormalizedPerformance): number {
  // Reward = conversion rate weighted by CTR, so we don't overfit to cheap clicks with no downstream conversions.
  return v.conversionRate * 0.7 + v.ctr * 0.3;
}

/**
 * Epsilon-greedy multi-armed bandit over campaign variants: mostly exploit the
 * best performer, occasionally explore another to avoid starving variants that
 * haven't accumulated enough data yet. Feeds decisions back to the orchestrator,
 * closing the loop from performance data -> budget/pause actions.
 */
export async function runOptimizationPass(campaignId: string): Promise<OptimizationDecision[]> {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const stats = normalizePerformance(campaignId);
  const decisions: OptimizationDecision[] = [];
  const decidedAt = new Date().toISOString();

  if (stats.length === 0) return decisions;

  const withEnoughData = stats.filter((s) => s.conversions >= MIN_CONVERSIONS_FOR_CONFIDENCE);
  const best = [...withEnoughData].sort((a, b) => score(b) - score(a))[0];
  const bestCpa = withEnoughData.filter((s) => s.cpaCents !== null).sort((a, b) => (a.cpaCents ?? Infinity) - (b.cpaCents ?? Infinity))[0]?.cpaCents;

  const activeVariants = campaign.variants.filter((v) => v.status === "active");
  const perVariantBudget = Math.floor(campaign.dailyBudgetCents / Math.max(activeVariants.length, 1));

  for (const variant of activeVariants) {
    const stat = stats.find((s) => s.variantId === variant.id);
    if (!stat) {
      decisions.push({ campaignId, chosenVariantId: variant.id, action: "hold", reason: "No performance data yet", decidedAt });
      continue;
    }

    if (typeof bestCpa === "number" && stat.cpaCents !== null && stat.cpaCents > bestCpa * MAX_CPA_MULTIPLIER) {
      await pauseVariant(campaignId, variant.id);
      decisions.push({
        campaignId,
        chosenVariantId: variant.id,
        action: "pause",
        reason: `CPA ${(stat.cpaCents / 100).toFixed(2)} exceeds ${MAX_CPA_MULTIPLIER}x the cohort best (${(bestCpa / 100).toFixed(2)})`,
        decidedAt,
      });
      continue;
    }

    const explore = Math.random() < EPSILON;
    const isWinner = best && variant.id === best.variantId;

    if (isWinner && !explore) {
      const boosted = Math.round(perVariantBudget * 1.3);
      await reallocateBudget(campaignId, variant.id, boosted);
      decisions.push({
        campaignId,
        chosenVariantId: variant.id,
        action: "increase_budget",
        reason: `Top scorer (conv. rate ${(stat.conversionRate * 100).toFixed(1)}%, CTR ${(stat.ctr * 100).toFixed(1)}%) — exploiting`,
        decidedAt,
      });
    } else if (withEnoughData.length > 0 && !isWinner) {
      const reduced = Math.round(perVariantBudget * 0.85);
      await reallocateBudget(campaignId, variant.id, reduced);
      decisions.push({
        campaignId,
        chosenVariantId: variant.id,
        action: "decrease_budget",
        reason: explore ? "Exploration slot: keeping funded but below the leader" : "Below top scorer — reducing spend",
        decidedAt,
      });
    } else {
      decisions.push({ campaignId, chosenVariantId: variant.id, action: "hold", reason: "Accumulating data before reallocating", decidedAt });
    }
  }

  return decisions;
}
