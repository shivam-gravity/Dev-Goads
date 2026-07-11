import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, ResearchContext, SeasonalityTimingAgentOutput } from "../types/index.js";

const SEASONALITY_TIMING_AGENT_TOOL = {
  name: "emit_seasonality_timing_agent_result",
  description: "Return the recommended launch timing and seasonal considerations for this campaign.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendedLaunchWindow: { type: "string", description: "e.g. \"Launch now — Q4 demand is rising\" or \"Wait until January — Q4 is oversaturated for this category\"" },
      seasonalConsiderations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      dayPartingRecommendation: { type: "string", description: "e.g. \"Weekday evenings 6-10pm — matches B2C browsing behavior\"" },
    },
    required: ["recommendedLaunchWindow", "seasonalConsiderations", "dayPartingRecommendation"],
  },
};

const seasonalityTimingAgentSchema: z.ZodType<SeasonalityTimingAgentOutput> = z.object({
  recommendedLaunchWindow: z.string(),
  seasonalConsiderations: z.array(z.string()),
  dayPartingRecommendation: z.string(),
});

function fallback(): SeasonalityTimingAgentOutput {
  return {
    recommendedLaunchWindow: "Launch now — no seasonal data available to suggest otherwise.",
    seasonalConsiderations: ["Not yet researched"],
    dayPartingRecommendation: "Unknown — no live market/news research available.",
  };
}

/** Recommends launch timing, seasonal considerations, and day-parting — grounded in
 * market seasonality signals and recent news trends, independent of every other agent. */
export class SeasonalityTimingAgent implements AIAgent<SeasonalityTimingAgentOutput> {
  readonly name = "seasonality-timing-agent";
  readonly promptId = "seasonality-timing-agent";

  async execute(context: ResearchContext): Promise<AgentResult<SeasonalityTimingAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["market", "news"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          market: JSON.stringify(context.market ?? {}),
          news: JSON.stringify(context.news ?? {}),
        },
        tool: SEASONALITY_TIMING_AGENT_TOOL,
        schema: seasonalityTimingAgentSchema,
        maxTokens: 640,
        fallback,
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: collectEvidence(context, [...fields]),
      };
    });
  }
}
