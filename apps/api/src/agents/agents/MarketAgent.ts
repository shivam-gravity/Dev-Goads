import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, MarketAgentOutput, ResearchContext } from "../types/index.js";

const MARKET_AGENT_TOOL = {
  name: "emit_market_agent_result",
  description: "Return a market opportunity score and risk assessment.",
  input_schema: {
    type: "object" as const,
    properties: {
      opportunityScore: { type: "integer", minimum: 0, maximum: 100, description: "0-100, where 100 is the strongest possible opportunity" },
      marketSummary: { type: "string" },
      risks: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
      recommendedRegion: { type: "string" },
    },
    required: ["opportunityScore", "marketSummary", "risks", "recommendedRegion"],
  },
};

const marketAgentSchema: z.ZodType<MarketAgentOutput> = z.object({
  opportunityScore: z.number().min(0).max(100),
  marketSummary: z.string(),
  risks: z.array(z.string()),
  recommendedRegion: z.string(),
});

function fallback(context: ResearchContext): MarketAgentOutput {
  return {
    opportunityScore: 40,
    marketSummary: context.market?.trends?.join("; ") || "Insufficient market research to score this opportunity confidently.",
    risks: ["No live market research performed"],
    recommendedRegion: context.market?.recommendedRegion ?? "United States",
  };
}

/** Scores market opportunity/risk from market + company research — independent of every
 * other agent. */
export class MarketAgent implements AIAgent<MarketAgentOutput> {
  readonly name = "market-agent";
  readonly promptId = "market-agent";

  async execute(context: ResearchContext): Promise<AgentResult<MarketAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["market", "company"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          market: JSON.stringify(context.market ?? {}),
          company: JSON.stringify(context.company ?? {}),
        },
        tool: MARKET_AGENT_TOOL,
        schema: marketAgentSchema,
        maxTokens: 640,
        fallback: () => fallback(context),
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        modelSource,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: collectEvidence(context, [...fields]),
      };
    });
  }
}
