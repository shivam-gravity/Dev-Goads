import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, AudienceAgentOutput, ResearchContext } from "../types/index.js";

const AUDIENCE_AGENT_TOOL = {
  name: "emit_audience_agent_result",
  description: "Return a targeting-ready audience summary.",
  input_schema: {
    type: "object" as const,
    properties: {
      primaryAudience: { type: "string" },
      segments: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] },
      },
      painPoints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      interestTags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
      targetingNotes: { type: "string", description: "1-2 sentences of practical ad-targeting guidance" },
    },
    required: ["primaryAudience", "segments", "painPoints", "interestTags", "targetingNotes"],
  },
};

const audienceAgentSchema: z.ZodType<AudienceAgentOutput> = z.object({
  primaryAudience: z.string(),
  segments: z.array(z.object({ name: z.string(), description: z.string() })),
  painPoints: z.array(z.string()),
  interestTags: z.array(z.string()),
  targetingNotes: z.string(),
});

function fallback(context: ResearchContext): AudienceAgentOutput {
  return {
    primaryAudience: context.audience?.primaryAudience ?? "General audience",
    segments: context.audience?.segments ?? [],
    painPoints: context.audience?.painPoints ?? [],
    interestTags: context.audience?.interestTags ?? [],
    targetingNotes: "Insufficient research data to give specific targeting guidance.",
  };
}

/** Refines target-audience research into targeting-ready segments/notes — independent of
 * every other agent. */
export class AudienceAgent implements AIAgent<AudienceAgentOutput> {
  readonly name = "audience-agent";
  readonly promptId = "audience-agent";

  async execute(context: ResearchContext): Promise<AgentResult<AudienceAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["audience", "market", "keywords"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          audience: JSON.stringify(context.audience ?? {}),
          market: JSON.stringify(context.market ?? {}),
          keywords: JSON.stringify(context.keywords ?? {}),
        },
        tool: AUDIENCE_AGENT_TOOL,
        schema: audienceAgentSchema,
        maxTokens: 768,
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
