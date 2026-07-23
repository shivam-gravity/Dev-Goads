import { isValidObjective, type MetaCampaignObjective } from "./metaObjectives.js";

/**
 * Forward-looking budget/goal simulator for the campaign-generation flow's "drag the budget,
 * preview the outcome" UI. This is a deliberately transparent HEURISTIC, not a real ad-network
 * forecast: it projects the outcome of a budget the user has NOT spent yet, so there are no
 * real conversion values to draw on — revenue is estimated from an assumed average order value
 * (ASSUMED_AOV_CENTS below) and the preview is explicitly labeled `source: "heuristic"`. This is
 * distinct from measured ROAS everywhere else, which now uses real network-reported revenue.
 *
 * Prefer real forecast numbers when they exist: the caller (router) first checks whether the
 * generation job's decisionContext already carries a forecasting-kpi-agent projection and returns
 * that; this heuristic is the fallback for the pre-generation setup screen where no job exists yet.
 */

/** Assumed average order value (cents) for the pre-spend budget PREVIEW only — a hypothetical
 * projection has no real purchase data to use. Not used for any measured/reported ROAS. */
const ASSUMED_AOV_CENTS = 5000;

export interface BudgetSimulationInput {
  objective?: string;
  dailyBudgetCents: number;
  /** Which ad platforms the campaign will run on. The heuristic blends per-platform delivery
   * characteristics (Google search converts richer clicks; Meta buys cheaper, broader reach), so
   * toggling platforms in the UI genuinely moves the preview. Empty/omitted → Meta-only default
   * (the platform the pipeline actually launches on today). */
  platforms?: ("meta" | "google")[];
  /** Optional: not used by the heuristic yet, but accepted so the contract is stable if we later
   * key CPM off geo. */
  countries?: string[];
}

export interface BudgetSimulation {
  estImpressionsPerDay: number;
  estClicks: number;
  estConversions: number;
  estRoas: number;
  /** Always "heuristic" here — flags to the UI that this is an estimate, not a network forecast. */
  source: "heuristic";
}

/**
 * Per-objective assumptions. CPM (cost per 1000 impressions, in cents), CTR (click-through rate),
 * and CVR (click→conversion rate) are broad industry-typical midpoints — awareness objectives buy
 * cheap impressions but convert poorly; sales/leads objectives cost more per impression but the
 * clicks they buy convert far better. Kept intentionally coarse; the point is directional feedback
 * as the user drags the budget, not a precise media plan.
 */
const OBJECTIVE_ASSUMPTIONS: Record<MetaCampaignObjective, { cpmCents: number; ctr: number; cvr: number }> = {
  OUTCOME_AWARENESS: { cpmCents: 500, ctr: 0.006, cvr: 0.01 },
  OUTCOME_TRAFFIC: { cpmCents: 900, ctr: 0.012, cvr: 0.02 },
  OUTCOME_ENGAGEMENT: { cpmCents: 700, ctr: 0.015, cvr: 0.015 },
  OUTCOME_LEADS: { cpmCents: 1500, ctr: 0.011, cvr: 0.08 },
  OUTCOME_APP_PROMOTION: { cpmCents: 1300, ctr: 0.01, cvr: 0.05 },
  OUTCOME_SALES: { cpmCents: 1800, ctr: 0.013, cvr: 0.06 },
};

const DEFAULT_ASSUMPTION = OBJECTIVE_ASSUMPTIONS.OUTCOME_TRAFFIC;

/**
 * Per-platform MULTIPLIERS applied on top of the objective's base CPM/CTR/CVR — broad, directional
 * midpoints, not a media plan. Google (search-led) buys pricier impressions but its intent-driven
 * clicks convert better; Meta (feed-led) buys cheap, broad reach that clicks more but converts
 * lower. When BOTH platforms are selected we average their multipliers (an even budget split), so
 * the combined preview sits between the two — which is why toggling a platform now visibly moves
 * the numbers instead of doing nothing. Kept as multipliers (not absolute values) so the objective
 * assumptions above stay the single source of base rates.
 */
const PLATFORM_MULTIPLIERS: Record<"meta" | "google", { cpm: number; ctr: number; cvr: number }> = {
  meta: { cpm: 0.9, ctr: 1.0, cvr: 0.9 },
  google: { cpm: 1.25, ctr: 1.35, cvr: 1.4 },
};

/** Turns objective + daily budget + platform mix into an estimated daily impressions/clicks/
 * conversions/ROAS preview. Platform selection blends the multipliers above. */
export function simulateBudget(input: BudgetSimulationInput): BudgetSimulation {
  const budgetCents = Math.max(0, input.dailyBudgetCents || 0);
  const base =
    input.objective && isValidObjective(input.objective)
      ? OBJECTIVE_ASSUMPTIONS[input.objective]
      : DEFAULT_ASSUMPTION;

  // Blend the selected platforms' multipliers (empty/unknown → Meta-only, the current launch
  // default). Averaging models an even budget split across the chosen platforms.
  const selected = (input.platforms ?? []).filter((p): p is "meta" | "google" => p === "meta" || p === "google");
  const platforms = selected.length > 0 ? selected : (["meta"] as const);
  const mult = platforms.reduce(
    (acc, p) => ({ cpm: acc.cpm + PLATFORM_MULTIPLIERS[p].cpm, ctr: acc.ctr + PLATFORM_MULTIPLIERS[p].ctr, cvr: acc.cvr + PLATFORM_MULTIPLIERS[p].cvr }),
    { cpm: 0, ctr: 0, cvr: 0 }
  );
  const cpmCents = base.cpmCents * (mult.cpm / platforms.length);
  const ctr = base.ctr * (mult.ctr / platforms.length);
  const cvr = base.cvr * (mult.cvr / platforms.length);

  const estImpressionsPerDay = cpmCents > 0 ? Math.round((budgetCents / cpmCents) * 1000) : 0;
  const estClicks = Math.round(estImpressionsPerDay * ctr);
  const estConversions = Math.round(estClicks * cvr);
  const estRevenueCents = estConversions * ASSUMED_AOV_CENTS;
  const estRoas = budgetCents > 0 ? Number((estRevenueCents / budgetCents).toFixed(2)) : 0;

  return { estImpressionsPerDay, estClicks, estConversions, estRoas, source: "heuristic" };
}
