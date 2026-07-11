import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, LocalizationAgentOutput, ResearchContext } from "../types/index.js";

const LOCALIZATION_AGENT_TOOL = {
  name: "emit_localization_agent_result",
  description: "Return which languages/regions to prioritize and how to culturally adapt messaging, not just translate it.",
  input_schema: {
    type: "object" as const,
    properties: {
      priorityLanguages: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      priorityRegions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      culturalAdaptationNotes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Concrete cultural adaptation notes — tone, imagery, holidays/seasonality, formality — not just 'translate the copy'" },
      translationCaveats: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "Terms/phrases that are hard to translate literally or carry unintended meaning in another market" },
    },
    required: ["priorityLanguages", "priorityRegions", "culturalAdaptationNotes", "translationCaveats"],
  },
};

const localizationAgentSchema: z.ZodType<LocalizationAgentOutput> = z.object({
  priorityLanguages: z.array(z.string()),
  priorityRegions: z.array(z.string()),
  culturalAdaptationNotes: z.array(z.string()),
  translationCaveats: z.array(z.string()),
});

function fallback(): LocalizationAgentOutput {
  return {
    priorityLanguages: ["English"],
    priorityRegions: ["United States"],
    culturalAdaptationNotes: ["No live market/company research available — defaulting to English/US"],
    translationCaveats: [],
  };
}

/** Recommends which languages/regions to prioritize and how to adapt messaging
 * culturally (not just translate it) — grounded in market/company/audience research,
 * independent of every other agent. Feeds the same aspect-ratio/language/quality Creative
 * Studio controls built earlier in the platform (apps/web CampaignBuilder.tsx). */
export class LocalizationAgent implements AIAgent<LocalizationAgentOutput> {
  readonly name = "localization-agent";
  readonly promptId = "localization-agent";

  async execute(context: ResearchContext): Promise<AgentResult<LocalizationAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["market", "company", "audience"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          market: JSON.stringify(context.market ?? {}),
          company: JSON.stringify(context.company ?? {}),
          audience: JSON.stringify(context.audience ?? {}),
        },
        tool: LOCALIZATION_AGENT_TOOL,
        schema: localizationAgentSchema,
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
