import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, ResearchContext, SEOContentAgentOutput } from "../types/index.js";

const SEO_CONTENT_AGENT_TOOL = {
  name: "emit_seo_content_agent_result",
  description: "Return on-page/content SEO recommendations — distinct from ad-keyword strategy.",
  input_schema: {
    type: "object" as const,
    properties: {
      contentGapsToFill: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Topics/pages the site should add to rank for its own keyword research" },
      onPageRecommendations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Concrete on-page fixes: heading structure, internal linking, content depth" },
      titleTagSuggestion: { type: "string", description: "A specific improved <title> tag suggestion" },
      metaDescriptionSuggestion: { type: "string", description: "A specific improved meta description suggestion" },
    },
    required: ["contentGapsToFill", "onPageRecommendations", "titleTagSuggestion", "metaDescriptionSuggestion"],
  },
};

const seoContentAgentSchema: z.ZodType<SEOContentAgentOutput> = z.object({
  contentGapsToFill: z.array(z.string()),
  onPageRecommendations: z.array(z.string()),
  titleTagSuggestion: z.string(),
  metaDescriptionSuggestion: z.string(),
});

function fallback(): SEOContentAgentOutput {
  return {
    contentGapsToFill: ["Not yet researched"],
    onPageRecommendations: ["Ensure a single clear H1 and descriptive meta title/description"],
    titleTagSuggestion: "Unknown — no live SEO/website research available.",
    metaDescriptionSuggestion: "Unknown — no live SEO/website research available.",
  };
}

/** On-page/content SEO recommendations (title tags, content gaps, heading structure) —
 * distinct from KeywordAgent, which focuses on paid-search ad-group/negative-keyword
 * strategy rather than organic content. Independent of every other agent. */
export class SEOContentAgent implements AIAgent<SEOContentAgentOutput> {
  readonly name = "seo-content-agent";
  readonly promptId = "seo-content-agent";

  async execute(context: ResearchContext): Promise<AgentResult<SEOContentAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["keywords", "website", "contentMarketing", "backlinkAuthority", "searchRanking", "serpFeatures"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          keywords: JSON.stringify(context.keywords ?? {}),
          website: JSON.stringify(context.website ?? {}),
          contentMarketing: JSON.stringify(context.contentMarketing ?? {}),
          backlinkAuthority: JSON.stringify(context.backlinkAuthority ?? {}),
          searchRanking: JSON.stringify(context.searchRanking ?? {}),
          serpFeatures: JSON.stringify(context.serpFeatures ?? {}),
        },
        tool: SEO_CONTENT_AGENT_TOOL,
        schema: seoContentAgentSchema,
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
