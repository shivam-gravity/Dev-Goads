import { openai, runStructured } from "../../infra/openaiClient.js";
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
            platforms: { type: "array", items: { type: "string", enum: ["meta", "google", "tiktok", "linkedin", "other"] }, minItems: 1, maxItems: 3 },
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

const DEFAULT_DAILY_BUDGET_CENTS = 10000;

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

  let fields: StrategyFields[];
  if (!openai) {
    fields = fallbackStrategies(businessLabel);
  } else {
    const structured = await runStructured<{ strategies: StrategyFields[] }>({
      maxTokens: 2048,
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
    fields = structured?.strategies?.length === 3 ? structured.strategies : fallbackStrategies(businessLabel);
  }

  const confidence = computeStrategyConfidence(context, topRecommendations);

  return fields.map((f, index) => ({
    id: `strategy-${String.fromCharCode(97 + index)}`,
    label: f.label,
    targetAudience: f.targetAudience,
    platforms: f.platforms,
    objective: f.objective,
    budgetDailyCents: DEFAULT_DAILY_BUDGET_CENTS,
    creativeDirection: f.creativeDirection,
    messaging: f.messaging,
    offer: f.offer,
    expectedKpi: f.expectedKpi,
    strengths: f.strengths,
    weaknesses: f.weaknesses,
    confidence,
  }));
}
