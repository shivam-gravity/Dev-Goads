import { openai, runStructured } from "../../infra/openaiClient.js";
import type { DifficultyLevel, Recommendation, TradeoffAnalysis } from "./types.js";

/**
 * Trade-off Engine — for every recommendation, explains what you gain, what you risk, what
 * else you could do instead, the expected business impact, and how hard it is to implement.
 * One batched structured call covers every recommendation at once (cheaper than N calls),
 * with the model asked to return items in the same order/count as the input so recommendation
 * IDs are assigned by this code, never trusted from model output.
 */

const TRADEOFF_TOOL = {
  name: "emit_tradeoffs",
  description: "Return a trade-off analysis for each recommendation, in the same order given.",
  input_schema: {
    type: "object" as const,
    properties: {
      tradeoffs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            benefits: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
            risks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
            alternatives: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "Other viable approaches instead of this recommendation" },
            expectedBusinessImpact: { type: "string" },
            implementationComplexity: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["benefits", "risks", "alternatives", "expectedBusinessImpact", "implementationComplexity"],
        },
      },
    },
    required: ["tradeoffs"],
  },
};

interface TradeoffFields {
  benefits: string[];
  risks: string[];
  alternatives: string[];
  expectedBusinessImpact: string;
  implementationComplexity: DifficultyLevel;
}

function fallbackTradeoff(recommendation: Recommendation): TradeoffFields {
  return {
    benefits: [recommendation.expectedOutcome],
    risks: ["No live research was available to assess risk in detail."],
    alternatives: ["Re-run research with a live API key for a fuller trade-off analysis."],
    expectedBusinessImpact: `Estimated ${recommendation.impact} impact based on limited grounding.`,
    implementationComplexity: recommendation.estimatedDifficulty,
  };
}

export async function analyzeTradeoffs(recommendations: Recommendation[]): Promise<TradeoffAnalysis[]> {
  if (recommendations.length === 0) return [];

  let fields: TradeoffFields[];
  if (!openai) {
    fields = recommendations.map(fallbackTradeoff);
  } else {
    const structured = await runStructured<{ tradeoffs: TradeoffFields[] }>({
      maxTokens: 2048,
      tool: TRADEOFF_TOOL,
      messages: [
        {
          role: "user",
          content: `For each of these ${recommendations.length} marketing recommendations, analyze the trade-offs. Return exactly ${recommendations.length} items in the same order.\n\n${recommendations
            .map((r, i) => `${i + 1}. [${r.category}] ${r.title} — ${r.reason} (expected outcome: ${r.expectedOutcome})`)
            .join("\n")}`,
        },
      ],
    });
    fields = structured?.tradeoffs?.length === recommendations.length ? structured.tradeoffs : recommendations.map(fallbackTradeoff);
  }

  return recommendations.map((recommendation, index) => ({
    recommendationId: recommendation.id,
    ...(fields[index] ?? fallbackTradeoff(recommendation)),
  }));
}
