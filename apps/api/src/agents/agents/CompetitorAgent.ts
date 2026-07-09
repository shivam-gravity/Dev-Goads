import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, CompetitorAgentOutput, ResearchContext } from "../types/index.js";

const COMPETITOR_AGENT_TOOL = {
  name: "emit_competitor_agent_result",
  description: "Return a competitive differentiation strategy.",
  input_schema: {
    type: "object" as const,
    properties: {
      competitors: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
      competitiveAdvantages: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      threats: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
      positioningRecommendation: { type: "string" },
    },
    required: ["competitors", "competitiveAdvantages", "threats", "positioningRecommendation"],
  },
};

const competitorAgentSchema: z.ZodType<CompetitorAgentOutput> = z.object({
  competitors: z.array(z.string()),
  competitiveAdvantages: z.array(z.string()),
  threats: z.array(z.string()),
  positioningRecommendation: z.string(),
});

function fallback(context: ResearchContext): CompetitorAgentOutput {
  return {
    competitors: context.competitors?.competitors.map((c) => c.name) ?? [],
    competitiveAdvantages: context.competitors?.differentiators ?? ["Distinct offering worth exploring further"],
    threats: [],
    positioningRecommendation: "Insufficient competitor research to recommend specific positioning.",
  };
}

/** Synthesizes a differentiation strategy from competitor/market research — independent
 * of every other agent. */
export class CompetitorAgent implements AIAgent<CompetitorAgentOutput> {
  readonly name = "competitor-agent";
  readonly promptId = "competitor-agent";

  async execute(context: ResearchContext): Promise<AgentResult<CompetitorAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["competitors", "market"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          competitors: JSON.stringify(context.competitors ?? {}),
          market: JSON.stringify(context.market ?? {}),
        },
        tool: COMPETITOR_AGENT_TOOL,
        schema: competitorAgentSchema,
        maxTokens: 768,
        fallback: () => fallback(context),
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
