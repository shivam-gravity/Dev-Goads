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
      personas: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        description: "Named audience personas, each with real Meta-ads interest keywords — one per distinct buyer segment",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "e.g. \"Growth-Focused CMO\"" },
            ageRange: { type: "string", description: "e.g. \"35-55\"" },
            genderSplit: { type: "string", description: "e.g. \"60% Male, 40% Female\"" },
            details: { type: "string", description: "1-2 sentences on who this persona is and why they convert" },
            interests: { type: "array", items: { type: "string" }, minItems: 6, maxItems: 15, description: "Real Meta Ads interest keywords (brands, job titles, tools) — not generic terms" },
          },
          required: ["name", "ageRange", "genderSplit", "details", "interests"],
        },
      },
    },
    required: ["primaryAudience", "segments", "painPoints", "interestTags", "targetingNotes", "personas"],
  },
};

const audienceAgentSchema: z.ZodType<AudienceAgentOutput> = z.object({
  primaryAudience: z.string(),
  segments: z.array(z.object({ name: z.string(), description: z.string() })),
  painPoints: z.array(z.string()),
  interestTags: z.array(z.string()),
  targetingNotes: z.string(),
  personas: z.array(z.object({
    name: z.string(),
    ageRange: z.string(),
    genderSplit: z.string(),
    details: z.string(),
    interests: z.array(z.string()),
  })),
});

function fallback(context: ResearchContext): AudienceAgentOutput {
  const segments = context.audience?.segments ?? [];
  const interestTags = context.audience?.interestTags ?? [];
  return {
    primaryAudience: context.audience?.primaryAudience ?? "General audience",
    segments,
    painPoints: context.audience?.painPoints ?? [],
    interestTags,
    targetingNotes: "Insufficient research data to give specific targeting guidance.",
    // Derive minimal personas from whatever segments research found, so the merged
    // persona output is never empty even on the fallback path.
    personas: segments.slice(0, 6).map((s) => ({
      name: s.name,
      ageRange: "25-54",
      genderSplit: "Balanced distribution",
      details: s.description,
      interests: interestTags.slice(0, 8),
    })),
  };
}

/** Refines target-audience research into targeting-ready segments/notes — independent of
 * every other agent. */
export class AudienceAgent implements AIAgent<AudienceAgentOutput> {
  readonly name = "audience-agent";
  readonly promptId = "audience-agent";

  async execute(context: ResearchContext): Promise<AgentResult<AudienceAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["audience", "market", "keywords", "competitors"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          url: context.url ?? "",
          productSummary: context.company?.summary ?? context.website?.description ?? "",
          audience: JSON.stringify(context.audience ?? {}),
          market: JSON.stringify(context.market ?? {}),
          keywords: JSON.stringify(context.keywords ?? {}),
          competitors: JSON.stringify(context.competitors ?? {}),
        },
        tool: AUDIENCE_AGENT_TOOL,
        schema: audienceAgentSchema,
        maxTokens: 1500,
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
