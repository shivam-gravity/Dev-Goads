import { normalizePerformance, getRawMetrics } from "../pipeline/performancePipeline.js";
import { getCampaign, pauseVariant, reallocateBudget } from "../orchestrator/campaignOrchestrator.js";
import { tuneAudiences } from "./audienceTuning.js";
import { computeFatigueScore } from "./creativeFatigueDetector.js";
import { createGenerationJob, hasRecentFatigueRefresh } from "../generation/generationJobService.js";
import { creativeGenerationQueue } from "../../infra/queue.js";
import type { NormalizedPerformance, OptimizationDecision } from "../../types/index.js";

const EPSILON = 0.1; // exploration rate for epsilon-greedy allocation
const MIN_CONVERSIONS_FOR_CONFIDENCE = 5;
const MAX_CPA_MULTIPLIER = 2.5; // pause a variant once its CPA exceeds this multiple of the cohort's best CPA
// Don't re-trigger a fatigue refresh for the same variant on every 15-minute tick while it
// stays fatigued — give the creative-generation pipeline (and a human reviewing the result)
// a full day before considering that variant for another automatic refresh.
const FATIGUE_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a generation prompt from a live variant's own creative — reused when a fatigue
 * refresh triggers, since there's no guarantee a landingPageUrl is set (creativeGenerationService's
 * resolveContext needs either a productUrl or a prompt).
 */
function fatigueRefreshPrompt(creative: { headline: string; body: string }): string {
  return `Generate a fresh ad variation for a product/business currently advertised with the headline "${creative.headline}" and body copy "${creative.body}". Keep the same underlying product/offer, but produce a genuinely different creative angle and image — the current one has been running long enough that the audience is tuning it out.`;
}

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
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const stats = await normalizePerformance(campaignId);
  const decisions: OptimizationDecision[] = [];
  const decidedAt = new Date().toISOString();

  if (stats.length === 0) return decisions;

  const withEnoughData = stats.filter((s) => s.conversions >= MIN_CONVERSIONS_FOR_CONFIDENCE);
  const best = [...withEnoughData].sort((a, b) => score(b) - score(a))[0];
  const bestCpa = withEnoughData.filter((s) => s.cpaCents !== null).sort((a, b) => (a.cpaCents ?? Infinity) - (b.cpaCents ?? Infinity))[0]?.cpaCents;

  const activeVariants = campaign.variants.filter((v) => v.status === "active");
  const perVariantBudget = Math.floor(campaign.dailyBudgetCents / Math.max(activeVariants.length, 1));

  // Fatigue and budget/pause decisions are orthogonal — a variant can be converting fine
  // (no CPA/budget action warranted) while still showing a real fatigue signal, so this
  // check runs independently of the pause/budget branches below rather than being folded
  // into either.
  const dailyMetrics = await getRawMetrics(campaignId);

  for (const variant of activeVariants) {
    if (campaign.workspaceId) {
      const fatigue = computeFatigueScore(variant.id, dailyMetrics);
      if (fatigue.isFatigued) {
        const cooldownSince = new Date(Date.now() - FATIGUE_REFRESH_COOLDOWN_MS).toISOString();
        const alreadyTriggered = await hasRecentFatigueRefresh(campaign.businessId, variant.id, cooldownSince);
        if (!alreadyTriggered) {
          const job = await createGenerationJob(campaign.workspaceId, {
            businessId: campaign.businessId,
            prompt: variant.landingPageUrl ? undefined : fatigueRefreshPrompt(variant.creative),
            productUrl: variant.landingPageUrl,
            wantVideo: false,
            campaignId,
            variantId: variant.id,
            reason: "fatigue-refresh",
          });
          await creativeGenerationQueue.add("generate", { jobId: job.id });
          decisions.push({
            campaignId,
            chosenVariantId: variant.id,
            action: "regenerate_creative",
            reason: `Fatigue detected (${fatigue.reason}) — queued a fresh creative for review`,
            decidedAt,
          });
        }
      }
    }

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

  // Audience-level tuning runs after the per-variant pass: the variant loop optimizes individual
  // ads, this prunes a whole audience segment that's structurally unprofitable (targeting is
  // otherwise frozen at launch). Uses the same stats snapshot so it doesn't double-count spend.
  const audienceDecisions = await tuneAudiences(campaign, stats);
  decisions.push(...audienceDecisions);

  return decisions;
}
