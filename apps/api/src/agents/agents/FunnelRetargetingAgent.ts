import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, FunnelRetargetingAgentOutput, ResearchContext } from "../types/index.js";

const FUNNEL_RETARGETING_AGENT_TOOL = {
  name: "emit_funnel_retargeting_agent_result",
  description: "Return a funnel-stage budget split and retargeting/awareness audience strategy.",
  input_schema: {
    type: "object" as const,
    properties: {
      funnelStageSplit: {
        type: "object",
        properties: { awareness: { type: "number" }, consideration: { type: "number" }, retargeting: { type: "number" } },
        required: ["awareness", "consideration", "retargeting"],
        description: "Fractions that sum to 1 across the 3 funnel stages",
      },
      retargetingAudiences: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Specific retargeting audience definitions (e.g. \"Site visitors 30d, no purchase\", \"Cart abandoners\")" },
      awarenessAngles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Broad top-of-funnel angles for cold audiences" },
    },
    required: ["funnelStageSplit", "retargetingAudiences", "awarenessAngles"],
  },
};

const funnelRetargetingAgentSchema: z.ZodType<FunnelRetargetingAgentOutput> = z.object({
  funnelStageSplit: z.record(z.number()),
  retargetingAudiences: z.array(z.string()),
  awarenessAngles: z.array(z.string()),
});

function fallback(): FunnelRetargetingAgentOutput {
  return {
    funnelStageSplit: { awareness: 0.5, consideration: 0.3, retargeting: 0.2 },
    retargetingAudiences: ["Site visitors 30d, no purchase"],
    awarenessAngles: ["Not yet researched"],
  };
}

/** Recommends funnel-stage budget allocation (awareness/consideration/retargeting) and
 * concrete retargeting audience definitions — grounded in audience and competitor
 * research, independent of every other agent. */
export class FunnelRetargetingAgent implements AIAgent<FunnelRetargetingAgentOutput> {
  readonly name = "funnel-retargeting-agent";
  readonly promptId = "funnel-retargeting-agent";

  async execute(context: ResearchContext): Promise<AgentResult<FunnelRetargetingAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["audience", "competitors"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          audience: JSON.stringify(context.audience ?? {}),
          competitors: JSON.stringify(context.competitors ?? {}),
        },
        tool: FUNNEL_RETARGETING_AGENT_TOOL,
        schema: funnelRetargetingAgentSchema,
        maxTokens: 768,
        fallback,
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
