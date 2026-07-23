import { callDecisionModel } from "./support.js";
import { hostnameOf } from "../providers/support.js";
import type { ResearchContext } from "../types/index.js";
import type { CampaignStrategy, Platform, RankedRecommendation } from "./types.js";

/**
 * Strategy Engine — assembles the ranked recommendations into distinct, competing campaign
 * strategies (minimum A/B/C) rather than one blended "best guess." Each strategy is a
 * coherent bet (e.g. "narrow ICP, premium positioning" vs. "broad reach, value positioning")
 * so the Simulation Engine downstream has genuinely different options to compare, not
 * cosmetic variations of the same plan.
 */

const STRATEGY_TOOL = {
  name: "emit_strategies",
  description: "Return exactly 3 distinct campaign strategies (A, B, C) grounded in the given recommendations.",
  input_schema: {
    type: "object" as const,
    properties: {
      strategies: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            label: { type: "string", enum: ["Strategy A", "Strategy B", "Strategy C"] },
            targetAudience: { type: "string" },
            platforms: { type: "array", items: { type: "string", enum: ["meta", "google"] }, minItems: 1, maxItems: 2 },
            objective: { type: "string" },
            creativeDirection: { type: "string" },
            messaging: { type: "string" },
            offer: { type: "string" },
            expectedKpi: { type: "string" },
            strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
            weaknesses: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
          },
          required: ["label", "targetAudience", "platforms", "objective", "creativeDirection", "messaging", "offer", "expectedKpi", "strengths", "weaknesses"],
        },
      },
    },
    required: ["strategies"],
  },
};

interface StrategyFields {
  label: string;
  targetAudience: string;
  platforms: Platform[];
  objective: string;
  creativeDirection: string;
  messaging: string;
  offer: string;
  expectedKpi: string;
  strengths: string[];
  weaknesses: string[];
}

const BASE_DAILY_BUDGET_CENTS = 5000;
const MIN_DAILY_BUDGET_CENTS = 2000;
const MAX_DAILY_BUDGET_CENTS = 50000;

/** Higher competitive pressure means more spend is needed to be seen at all — reads the
 * same competitionIntensity/competitor-count signal CompetitorAgent already surfaces to
 * the UI, so this multiplier and what a user sees in the Competitor tab never disagree. */
function competitionMultiplier(context: ResearchContext): number {
  const intensity = (context.competitors?.competitionIntensity ?? "").toLowerCase();
  const competitorCount = context.competitors?.competitors.length ?? 0;
  if (intensity.includes("high") || competitorCount >= 4) return 1.6;
  if (intensity.includes("moderate") || competitorCount >= 2) return 1.2;
  if (intensity.includes("low")) return 0.85;
  return 1;
}

/** A well-funded/public company can sustain a higher daily spend than a bootstrapped one —
 * best-effort keyword read of CompanyProvider's free-text fundingStage, defaulting to 1x
 * (no adjustment) whenever the stage is missing/unrecognized rather than guessing. */
function companySizeMultiplier(context: ResearchContext): number {
  const stage = (context.company?.fundingStage ?? "").toLowerCase();
  if (/public|ipo|series [c-f]/.test(stage)) return 1.8;
  if (/series [ab]/.test(stage)) return 1.3;
  if (/seed|bootstrap/.test(stage)) return 0.8;
  return 1;
}

/** More platforms = more inventory to fund; a single-platform play can run leaner. */
function platformMultiplier(platformCount: number): number {
  if (platformCount >= 3) return 1.3;
  if (platformCount === 2) return 1.1;
  return 0.9;
}

/** Reach/awareness objectives are inherently more expensive to fund at meaningful scale
 * than a narrow, high-intent conversion play. */
function objectiveMultiplier(objective: string): number {
  const o = objective.toLowerCase();
  if (/reach|awareness|impression/.test(o)) return 1.2;
  if (/conversion|cpa|sign-?up|purchase/.test(o)) return 0.9;
  return 1;
}

/**
 * Deterministic per-strategy daily budget — never an LLM self-report, same principle as
 * every other score in this engine (see MarketIntelligenceEngine's computeOpportunityScore).
 * Blends real signals already sitting in ResearchContext (competition, company stage) with
 * this specific strategy's own shape (platform count, objective), so the 3 candidate
 * strategies actually differ from each other and from one business to the next — replacing
 * a flat constant that gave every business and every strategy the same $100/day regardless
 * of research.
 */
function computeStrategyDailyBudgetCents(context: ResearchContext, platforms: Platform[], objective: string): number {
  const raw =
    BASE_DAILY_BUDGET_CENTS *
    competitionMultiplier(context) *
    companySizeMultiplier(context) *
    platformMultiplier(platforms.length) *
    objectiveMultiplier(objective);
  const roundedToNearest500 = Math.round(raw / 500) * 500;
  return Math.max(MIN_DAILY_BUDGET_CENTS, Math.min(MAX_DAILY_BUDGET_CENTS, roundedToNearest500));
}

function fallbackStrategies(businessLabel: string): StrategyFields[] {
  return [
    {
      label: "Strategy A",
      targetAudience: `Primary audience for ${businessLabel} (unresearched)`,
      platforms: ["meta"],
      objective: "Awareness",
      creativeDirection: "Not yet researched",
      messaging: "Not yet researched",
      offer: "Not yet researched",
      expectedKpi: "CTR",
      strengths: ["Low cost to launch"],
      weaknesses: ["No live research behind this strategy"],
    },
    {
      label: "Strategy B",
      targetAudience: `Secondary audience for ${businessLabel} (unresearched)`,
      platforms: ["google"],
      objective: "Conversions",
      creativeDirection: "Not yet researched",
      messaging: "Not yet researched",
      offer: "Not yet researched",
      expectedKpi: "CPA",
      strengths: ["Low cost to launch"],
      weaknesses: ["No live research behind this strategy"],
    },
    {
      label: "Strategy C",
      targetAudience: `Broad audience for ${businessLabel} (unresearched)`,
      platforms: ["meta", "google"],
      objective: "Reach",
      creativeDirection: "Not yet researched",
      messaging: "Not yet researched",
      offer: "Not yet researched",
      expectedKpi: "Impressions",
      strengths: ["Low cost to launch"],
      weaknesses: ["No live research behind this strategy"],
    },
  ];
}

/** Deterministic strategy confidence: blends how well-grounded the research overall is
 * with how strong the top recommendations backing this strategy actually scored — never an
 * LLM self-report, consistent with recommendation/ranking confidence in this engine. */
function computeStrategyConfidence(context: ResearchContext, topRecommendations: RankedRecommendation[]): number {
  const researchConfidence = context.metadata.fusion?.overallFusedConfidence ?? context.metadata.overallConfidence;
  if (topRecommendations.length === 0) return Math.round(researchConfidence * 100) / 100;
  const avgFinalScore = topRecommendations.reduce((sum, r) => sum + r.finalScore, 0) / topRecommendations.length / 100;
  return Math.round(((researchConfidence + avgFinalScore) / 2) * 100) / 100;
}

export async function generateStrategies(context: ResearchContext, recommendations: RankedRecommendation[]): Promise<CampaignStrategy[]> {
  const businessLabel = context.company?.name ?? hostnameOf(context.url);
  const topRecommendations = recommendations.slice(0, 5);

  const structured = await callDecisionModel<{ strategies: StrategyFields[] }>({
    taskName: "strategy-synthesis",
    // 4096: returns 3 FULL strategies (A/B/C) — each with target audience, platforms, objective,
    // budget, KPI, creative direction, messaging — and falls back ENTIRELY unless exactly 3 come
    // back. At 2048 a rich 3-strategy bundle risks truncating past the "=== 3" guard → generic
    // fallback strategies. These are the demo's centerpiece cards, so give headroom.
    maxTokens: 4096,
    tool: STRATEGY_TOOL,
    messages: [
      {
        role: "user",
        content: `For "${businessLabel}", propose exactly 3 distinct, competing campaign strategies (Strategy A, B, C) — each a genuinely different bet (e.g. narrow vs. broad audience, premium vs. value positioning, awareness vs. conversion), grounded in these top-ranked recommendations:\n\n${topRecommendations
          .map((r) => `- [${r.category}] ${r.title} (score ${r.finalScore}/100): ${r.reason}`)
          .join("\n")}\n\nAudience research: ${context.audience?.primaryAudience ?? "unknown"}. Market: ${context.market?.competitionLevel ?? "unknown"} competition.`,
      },
    ],
  });
  const fields: StrategyFields[] = structured?.strategies?.length === 3 ? structured.strategies : fallbackStrategies(businessLabel);

  const confidence = computeStrategyConfidence(context, topRecommendations);

  // Constrain every strategy to networks we can actually PUBLISH to. Only Meta + Google are live
  // (TikTok/LinkedIn are not), but the model would otherwise recommend linkedin/tiktok as the
  // winning channels — an unlaunchable strategy the user can't act on. Filter to the publishable
  // set, defaulting to meta+google if a strategy comes back with none. (When TikTok/LinkedIn go
  // live, widen PUBLISHABLE_PLATFORMS + the STRATEGY_TOOL enum together.)
  const PUBLISHABLE_PLATFORMS: Platform[] = ["meta", "google"];
  const constrainPlatforms = (platforms: Platform[]): Platform[] => {
    const kept = (platforms ?? []).filter((p) => PUBLISHABLE_PLATFORMS.includes(p));
    return kept.length > 0 ? kept : [...PUBLISHABLE_PLATFORMS];
  };

  return fields.map((f, index) => ({
    id: `strategy-${String.fromCharCode(97 + index)}`,
    label: f.label,
    targetAudience: f.targetAudience,
    platforms: constrainPlatforms(f.platforms),
    objective: f.objective,
    budgetDailyCents: computeStrategyDailyBudgetCents(context, constrainPlatforms(f.platforms), f.objective),
    creativeDirection: f.creativeDirection,
    messaging: f.messaging,
    offer: f.offer,
    expectedKpi: f.expectedKpi,
    strengths: f.strengths,
    weaknesses: f.weaknesses,
    confidence,
  }));
}
