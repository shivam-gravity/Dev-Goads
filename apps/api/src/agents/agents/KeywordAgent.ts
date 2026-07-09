import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, KeywordAgentOutput, ResearchContext } from "../types/index.js";

const KEYWORD_AGENT_TOOL = {
  name: "emit_keyword_agent_result",
  description: "Return an ad-group and negative-keyword strategy.",
  input_schema: {
    type: "object" as const,
    properties: {
      primaryKeywords: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 15 },
      adGroupSuggestions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, description: "Suggested ad-group themes/names" },
      negativeKeywords: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10 },
    },
    required: ["primaryKeywords", "adGroupSuggestions", "negativeKeywords"],
  },
};

const keywordAgentSchema: z.ZodType<KeywordAgentOutput> = z.object({
  primaryKeywords: z.array(z.string()),
  adGroupSuggestions: z.array(z.string()),
  negativeKeywords: z.array(z.string()),
});

function fallback(context: ResearchContext): KeywordAgentOutput {
  return {
    primaryKeywords: context.keywords?.primaryKeywords ?? [],
    adGroupSuggestions: [],
    negativeKeywords: [],
  };
}

/** Turns on-page keyword research into an ad-group/negative-keyword strategy —
 * independent of every other agent. */
export class KeywordAgent implements AIAgent<KeywordAgentOutput> {
  readonly name = "keyword-agent";
  readonly promptId = "keyword-agent";

  async execute(context: ResearchContext): Promise<AgentResult<KeywordAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["keywords", "website"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          keywords: JSON.stringify(context.keywords ?? {}),
          website: JSON.stringify(context.website ?? {}),
        },
        tool: KEYWORD_AGENT_TOOL,
        schema: keywordAgentSchema,
        maxTokens: 640,
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
