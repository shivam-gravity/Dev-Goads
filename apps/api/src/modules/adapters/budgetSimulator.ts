import { ESTIMATED_REVENUE_CENTS_PER_CONVERSION } from "../pipeline/performancePipeline.js";
import { isValidObjective, type MetaCampaignObjective } from "./metaObjectives.js";

/**
 * Forward-looking budget/goal simulator for the campaign-generation flow's "drag the budget,
 * preview the outcome" UI. This is a deliberately transparent HEURISTIC, not a real ad-network
 * forecast: the app has no historical per-account delivery data to fit against (see the note on
 * ESTIMATED_REVENUE_CENTS_PER_CONVERSION), so the preview is explicitly labeled an estimate.
 *
 * Prefer real forecast numbers when they exist: the caller (router) first checks whether the
 * generation job's decisionContext already carries a forecasting-kpi-agent projection and returns
 * that; this heuristic is the fallback for the pre-generation setup screen where no job exists yet.
 */

export interface BudgetSimulationInput {
  objective?: string;
  dailyBudgetCents: number;
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

/** Turns objective + daily budget into an estimated daily impressions/clicks/conversions/ROAS preview. */
export function simulateBudget(input: BudgetSimulationInput): BudgetSimulation {
  const budgetCents = Math.max(0, input.dailyBudgetCents || 0);
  const assumptions =
    input.objective && isValidObjective(input.objective)
      ? OBJECTIVE_ASSUMPTIONS[input.objective]
      : DEFAULT_ASSUMPTION;

  const estImpressionsPerDay = assumptions.cpmCents > 0 ? Math.round((budgetCents / assumptions.cpmCents) * 1000) : 0;
  const estClicks = Math.round(estImpressionsPerDay * assumptions.ctr);
  const estConversions = Math.round(estClicks * assumptions.cvr);
  const estRevenueCents = estConversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION;
  const estRoas = budgetCents > 0 ? Number((estRevenueCents / budgetCents).toFixed(2)) : 0;

  return { estImpressionsPerDay, estClicks, estConversions, estRoas, source: "heuristic" };
}
