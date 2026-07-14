import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, PersonaAgentOutput, ResearchContext } from "../types/index.js";

const PERSONA_AGENT_TOOL = {
  name: "emit_persona_agent_result",
  description: "Return named audience personas built from audience/keyword/market research.",
  input_schema: {
    type: "object" as const,
    properties: {
      personas: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            ageRange: { type: "string" },
            genderSplit: { type: "string" },
            details: { type: "string" },
            interests: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
          },
          required: ["name", "ageRange", "genderSplit", "details", "interests"],
        },
      },
    },
    required: ["personas"],
  },
};

const personaAgentSchema: z.ZodType<PersonaAgentOutput> = z.object({
  personas: z.array(
    z.object({
      name: z.string(),
      ageRange: z.string(),
      genderSplit: z.string(),
      details: z.string(),
      interests: z.array(z.string()),
    })
  ),
});

function fallback(context: ResearchContext): PersonaAgentOutput {
  const segments = context.audience?.segments ?? [];
  if (segments.length === 0) {
    return {
      personas: [
        {
          name: "General audience",
          ageRange: "25-54",
          genderSplit: "Balanced distribution",
          details: "Insufficient research data to build named personas.",
          interests: context.keywords?.primaryKeywords?.slice(0, 5) ?? [],
        },
      ],
    };
  }
  return {
    personas: segments.map((s) => ({
      name: s.name,
      ageRange: context.audience?.demographics?.ageDistribution ?? "25-54",
      genderSplit: context.audience?.demographics?.genderRatio ?? "Balanced distribution",
      details: s.description,
      interests: context.audience?.interestTags?.slice(0, 6) ?? [],
    })),
  };
}

/** Builds named audience personas from audience/keyword/market research — independent
 * of every other agent. */
export class PersonaAgent implements AIAgent<PersonaAgentOutput> {
  readonly name = "persona-agent";
  readonly promptId = "persona-agent";

  async execute(context: ResearchContext): Promise<AgentResult<PersonaAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["audience", "keywords", "market"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          audience: JSON.stringify(context.audience ?? {}),
          keywords: JSON.stringify(context.keywords ?? {}),
          market: JSON.stringify(context.market ?? {}),
        },
        tool: PERSONA_AGENT_TOOL,
        schema: personaAgentSchema,
        maxTokens: 1024,
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
