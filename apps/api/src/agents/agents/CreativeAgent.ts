import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { loadVerifiedFacts, verifiedFactsForPrompt } from "../crawlFacts.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, CreativeAgentOutput, ResearchContext } from "../types/index.js";

const CREATIVE_AGENT_TOOL = {
  name: "emit_creative_agent_result",
  description: "Return ad creative copy angles.",
  input_schema: {
    type: "object" as const,
    properties: {
      headlines: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      primaryTexts: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      callToAction: { type: "string" },
      creativeAngles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, description: "Short labels for each distinct creative angle, e.g. \"social proof\", \"urgency\"" },
    },
    required: ["headlines", "primaryTexts", "callToAction", "creativeAngles"],
  },
};

const creativeAgentSchema: z.ZodType<CreativeAgentOutput> = z.object({
  headlines: z.array(z.string()),
  primaryTexts: z.array(z.string()),
  callToAction: z.string(),
  creativeAngles: z.array(z.string()),
});

function fallback(context: ResearchContext): CreativeAgentOutput {
  const name = context.company?.name ?? context.website?.title ?? "This business";
  return {
    headlines: [`${name}: built for you`],
    primaryTexts: [context.website?.description ?? "See what makes us different."],
    callToAction: "Learn More",
    creativeAngles: ["general value proposition"],
  };
}

/** Generates ad copy angles from website/audience/company research — independent of
 * every other agent (does not consume other agents' outputs, only ResearchContext). */
export class CreativeAgent implements AIAgent<CreativeAgentOutput> {
  readonly name = "creative-agent";
  readonly promptId = "creative-agent";

  async execute(context: ResearchContext): Promise<AgentResult<CreativeAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["website", "audience", "company"] as const;
      const verifiedFacts = await loadVerifiedFacts(context);
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          verifiedFacts: verifiedFactsForPrompt(verifiedFacts),
          website: JSON.stringify(context.website ?? {}),
          audience: JSON.stringify(context.audience ?? {}),
          company: JSON.stringify(context.company ?? {}),
        },
        tool: CREATIVE_AGENT_TOOL,
        schema: creativeAgentSchema,
        maxTokens: 768,
        fallback: () => fallback(context),
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: [
          ...collectEvidence(context, [...fields]),
          ...(verifiedFacts.length > 0
            ? [{ source: "crawl-facts", detail: `Copy grounded in ${verifiedFacts.length} verified facts from the site crawl` }]
            : []),
        ],
      };
    });
  }
}
