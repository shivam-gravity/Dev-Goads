import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, ObjectionHandlingAgentOutput, ResearchContext } from "../types/index.js";

const OBJECTION_HANDLING_AGENT_TOOL = {
  name: "emit_objection_handling_agent_result",
  description: "Return the top real objections prospects raise and concrete rebuttal angles for ad copy.",
  input_schema: {
    type: "object" as const,
    properties: {
      topObjections: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Real objections/hesitations, grounded in audience pain points and real review complaints where available" },
      rebuttalAngles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Concrete ad-copy angles that directly address the objections above (one per objection where possible)" },
      trustSignalsToHighlight: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "Specific proof points to feature (reviews, guarantees, certifications) that counter the objections" },
    },
    required: ["topObjections", "rebuttalAngles", "trustSignalsToHighlight"],
  },
};

const objectionHandlingAgentSchema: z.ZodType<ObjectionHandlingAgentOutput> = z.object({
  topObjections: z.array(z.string()),
  rebuttalAngles: z.array(z.string()),
  trustSignalsToHighlight: z.array(z.string()),
});

function fallback(): ObjectionHandlingAgentOutput {
  return {
    topObjections: ["Not yet researched"],
    rebuttalAngles: ["Not yet researched"],
    trustSignalsToHighlight: [],
  };
}

/** Mines real customer pain points AND real review complaints (when the Reviews provider
 * ran) to surface the actual objections prospects raise, then recommends concrete
 * rebuttal-style ad copy angles — distinct from CreativeAgent's general copywriting,
 * independent of every other agent. */
export class ObjectionHandlingAgent implements AIAgent<ObjectionHandlingAgentOutput> {
  readonly name = "objection-handling-agent";
  readonly promptId = "objection-handling-agent";

  async execute(context: ResearchContext): Promise<AgentResult<ObjectionHandlingAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["audience", "reviews"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          audience: JSON.stringify(context.audience ?? {}),
          reviews: JSON.stringify(context.reviews ?? {}),
        },
        tool: OBJECTION_HANDLING_AGENT_TOOL,
        schema: objectionHandlingAgentSchema,
        maxTokens: 768,
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
