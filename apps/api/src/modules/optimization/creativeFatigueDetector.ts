import type { PerformanceMetric } from "../../types/index.js";

/**
 * Deterministic ad-fatigue signal from data the pipeline already collects — no LLM
 * involvement, same "explainable heuristic" style as optimizationEngine.ts's bandit logic.
 * Combines two independent signals so a variant is flagged on either real symptom, not
 * only one:
 *
 * 1. Frequency (impressions/reach) — how many times the same audience has seen this ad.
 *    Frequency climbing past ~3-4 for a static creative is a standard, well-established
 *    fatigue proxy in ad platforms generally.
 * 2. CTR trend — comparing a recent window's click-through rate against the window before
 *    it. A real decline (not just noise) is direct evidence the audience is tuning the ad
 *    out, independent of whether frequency itself looks high yet.
 *
 * Both are approximations, not ground truth: reach summed across multiple days
 * double-counts users who saw the ad on more than one of those days (this codebase already
 * treats summed reach as good enough elsewhere — see normalizePerformance in
 * performancePipeline.ts, which does the same thing) and short windows are noisy with low
 * traffic. Good enough to trigger a "maybe worth a fresh creative" signal, not precise
 * enough to justify auto-pausing a campaign on its own — that stays the CPA-threshold
 * check's job in optimizationEngine.ts.
 */

const FATIGUE_WINDOW_DAYS = 3;
const FREQUENCY_FATIGUE_THRESHOLD = 3.5;
const CTR_DECLINE_FATIGUE_THRESHOLD = 0.25; // 25% relative decline vs. the prior window

export interface FatigueAssessment {
  variantId: string;
  frequency: number | null;
  recentCtr: number | null;
  priorCtr: number | null;
  /** (priorCtr - recentCtr) / priorCtr — positive means CTR declined. Null when there isn't
   * enough history (fewer than 2*FATIGUE_WINDOW_DAYS days of data) to compare two windows. */
  ctrDeclineRatio: number | null;
  isFatigued: boolean;
  reason: string;
}

function ctrOf(rows: PerformanceMetric[]): number | null {
  const impressions = rows.reduce((s, m) => s + m.impressions, 0);
  const clicks = rows.reduce((s, m) => s + m.clicks, 0);
  return impressions > 0 ? clicks / impressions : null;
}

/** `dailyMetrics` is the campaign's full per-day metric history (from
 * analyticsStore.queryMetrics/getRawMetrics) — this filters to the one variant itself. */
export function computeFatigueScore(variantId: string, dailyMetrics: PerformanceMetric[]): FatigueAssessment {
  const forVariant = dailyMetrics.filter((m) => m.variantId === variantId).sort((a, b) => a.date.localeCompare(b.date));

  if (forVariant.length === 0) {
    return { variantId, frequency: null, recentCtr: null, priorCtr: null, ctrDeclineRatio: null, isFatigued: false, reason: "No performance data yet" };
  }

  const totalImpressions = forVariant.reduce((s, m) => s + m.impressions, 0);
  const totalReach = forVariant.reduce((s, m) => s + m.reach, 0);
  const frequency = totalReach > 0 ? totalImpressions / totalReach : null;

  const recentWindow = forVariant.slice(-FATIGUE_WINDOW_DAYS);
  const priorWindow = forVariant.slice(-FATIGUE_WINDOW_DAYS * 2, -FATIGUE_WINDOW_DAYS);

  const recentCtr = ctrOf(recentWindow);
  const priorCtr = priorWindow.length > 0 ? ctrOf(priorWindow) : null;
  const ctrDeclineRatio = recentCtr !== null && priorCtr !== null && priorCtr > 0 ? (priorCtr - recentCtr) / priorCtr : null;

  const highFrequency = frequency !== null && frequency >= FREQUENCY_FATIGUE_THRESHOLD;
  const decliningCtr = ctrDeclineRatio !== null && ctrDeclineRatio >= CTR_DECLINE_FATIGUE_THRESHOLD;
  const isFatigued = highFrequency || decliningCtr;

  const reasons = [
    highFrequency ? `frequency ${frequency!.toFixed(1)} exceeds ${FREQUENCY_FATIGUE_THRESHOLD}x` : null,
    decliningCtr ? `CTR down ${(ctrDeclineRatio! * 100).toFixed(0)}% vs. the prior ${FATIGUE_WINDOW_DAYS}-day window` : null,
  ].filter((r): r is string => r !== null);

  return {
    variantId,
    frequency,
    recentCtr,
    priorCtr,
    ctrDeclineRatio,
    isFatigued,
    reason: reasons.length > 0 ? reasons.join("; ") : "No fatigue signal",
  };
}
