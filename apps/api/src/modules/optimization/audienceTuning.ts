import { pauseVariant } from "../orchestrator/campaignOrchestrator.js";
import type { Campaign, NormalizedPerformance, OptimizationDecision } from "../../types/index.js";

/**
 * Post-launch audience tuning. The per-variant bandit in optimizationEngine shifts budget between
 * individual ads, but it never looks at the AUDIENCE dimension — targeting is frozen at launch and
 * never revisited, which is the gap vs. AdsGo's "keep tuning who sees the ads". A campaign is built
 * as several audience segments (e.g. Cold/Warm/Hot), each with its own ad set; if one whole segment
 * is structurally unprofitable, no amount of per-ad budget nudging fixes it.
 *
 * This adds an audience-level prune: aggregate performance by audienceName across a segment's
 * variants, and when the worst-performing audience's CPA runs far past the best audience's — with
 * enough data to be confident — pause that entire audience's variants. It's deliberately
 * conservative (pause, don't rebuild targeting) and only ever prunes the single worst laggard per
 * pass, never the best audience, so it can't collapse a campaign down to nothing in one tick.
 */

const MIN_CONVERSIONS_PER_AUDIENCE = 5; // don't judge an audience until it has enough signal
const AUDIENCE_CPA_MULTIPLIER = 3; // pause an audience whose CPA exceeds this multiple of the best audience's
const MIN_AUDIENCES_TO_PRUNE = 2; // never prune when there's only one audience (nothing to fall back to)

interface AudienceStat {
  audienceName: string;
  variantIds: string[];
  conversions: number;
  spendCents: number;
  cpaCents: number | null;
}

/** Group a campaign's active variants + their normalized performance by audienceName. */
function aggregateByAudience(campaign: Campaign, stats: NormalizedPerformance[]): AudienceStat[] {
  const byName = new Map<string, AudienceStat>();
  const statById = new Map(stats.map((s) => [s.variantId, s]));

  for (const variant of campaign.variants) {
    if (variant.status !== "active") continue;
    const name = variant.audienceName ?? "General Audience";
    const stat = statById.get(variant.id);
    if (!stat) continue;

    const agg = byName.get(name) ?? { audienceName: name, variantIds: [], conversions: 0, spendCents: 0, cpaCents: null };
    agg.variantIds.push(variant.id);
    agg.conversions += stat.conversions;
    agg.spendCents += stat.spendCents;
    byName.set(name, agg);
  }

  // Derive audience-level CPA once totals are summed (CPA of sums, not sum of CPAs).
  for (const agg of byName.values()) {
    agg.cpaCents = agg.conversions > 0 ? Math.round(agg.spendCents / agg.conversions) : null;
  }
  return [...byName.values()];
}

/**
 * Evaluate audience-level performance and pause the single worst audience if it's decisively
 * underperforming the best one. Returns the decisions taken (one per variant paused). Safe to call
 * every optimization pass — the cooldown against thrashing is provided by the fact that once an
 * audience's variants are paused they're no longer "active" and drop out of the next aggregation.
 */
export async function tuneAudiences(campaign: Campaign, stats: NormalizedPerformance[]): Promise<OptimizationDecision[]> {
  const decisions: OptimizationDecision[] = [];
  const audiences = aggregateByAudience(campaign, stats);

  // Only audiences with enough conversions to judge; need at least two so there's a survivor.
  const confident = audiences.filter((a) => a.conversions >= MIN_CONVERSIONS_PER_AUDIENCE && a.cpaCents !== null);
  if (confident.length < MIN_AUDIENCES_TO_PRUNE) return decisions;

  const sorted = [...confident].sort((a, b) => (a.cpaCents ?? Infinity) - (b.cpaCents ?? Infinity));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (best.audienceName === worst.audienceName) return decisions;

  const bestCpa = best.cpaCents!;
  const worstCpa = worst.cpaCents!;
  if (worstCpa <= bestCpa * AUDIENCE_CPA_MULTIPLIER) return decisions; // laggard isn't bad enough to cut

  const decidedAt = new Date().toISOString();
  for (const variantId of worst.variantIds) {
    await pauseVariant(campaign.id, variantId);
    decisions.push({
      campaignId: campaign.id,
      chosenVariantId: variantId,
      action: "pause_audience",
      reason:
        `Audience "${worst.audienceName}" CPA ${(worstCpa / 100).toFixed(2)} is >${AUDIENCE_CPA_MULTIPLIER}x the best ` +
        `audience "${best.audienceName}" (${(bestCpa / 100).toFixed(2)}) — pausing the segment`,
      decidedAt,
    });
  }
  return decisions;
}
