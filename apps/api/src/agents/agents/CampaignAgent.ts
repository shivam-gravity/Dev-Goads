import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { loadVerifiedFacts, verifiedFactsForPrompt } from "../crawlFacts.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, CampaignAgentOutput, ResearchContext } from "../types/index.js";

const NETWORK_ENUM = ["meta", "google", "tiktok"] as const;

const CAMPAIGN_AGENT_TOOL = {
  name: "emit_campaign_agent_result",
  description: "Return a full campaign strategy synthesized from all research dimensions.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "2-3 sentence strategy overview" },
      recommendedNetworks: { type: "array", items: { type: "string", enum: [...NETWORK_ENUM] }, minItems: 1, maxItems: 3 },
      budgetSplit: { type: "object", additionalProperties: { type: "number" }, description: "Fractions per network that sum to 1, e.g. {\"meta\": 0.6, \"google\": 0.4}" },
      audiences: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      creatives: {
        type: "array",
        description: "At least 8 distinct ad concepts — vary the angle (feature, offer, social proof, urgency, pain point, comparison) so every one reads as a genuinely different ad, not a rewording of the same one.",
        minItems: 8,
        maxItems: 12,
        items: {
          type: "object",
          properties: { headline: { type: "string" }, body: { type: "string" }, callToAction: { type: "string" } },
          required: ["headline", "body", "callToAction"],
        },
      },
    },
    required: ["summary", "recommendedNetworks", "budgetSplit", "audiences", "creatives"],
  },
};

const campaignAgentSchema: z.ZodType<CampaignAgentOutput> = z.object({
  summary: z.string(),
  recommendedNetworks: z.array(z.enum(NETWORK_ENUM)),
  budgetSplit: z.record(z.number()),
  audiences: z.array(z.string()),
  creatives: z.array(z.object({ headline: z.string(), body: z.string(), callToAction: z.string() })),
});

function fallback(context: ResearchContext): CampaignAgentOutput {
  const name = context.company?.name ?? context.website?.title ?? "This business";
  const description = context.website?.description ?? "what we offer";
  return {
    summary: `A balanced acquisition strategy for ${name}, pending fuller research.`,
    recommendedNetworks: ["meta"],
    budgetSplit: { meta: 1 },
    audiences: context.audience?.segments?.map((s) => s.name) ?? [context.audience?.primaryAudience ?? "General audience"],
    creatives: [
      { headline: name, body: `Discover ${description}.`, callToAction: "Learn More" },
      { headline: `Why choose ${name}?`, body: `See why customers pick ${name} for ${description}.`, callToAction: "Get Started" },
      { headline: `${name}: built for you`, body: `${description}, without the hassle.`, callToAction: "Sign Up" },
      { headline: `Try ${name} today`, body: `Join the customers already using ${name}.`, callToAction: "Get Offer" },
    ],
  };
}

/**
 * Synthesizes a full campaign strategy (networks, budget split, audiences, creatives)
 * directly from ResearchContext — deliberately does NOT consume the other 9 agents'
 * outputs (even though it overlaps in subject matter with Product/Audience/Budget/
 * Creative agents), so it stays independently testable exactly like every other agent:
 * one ResearchContext fixture in, one AgentResult out, no dependency graph to stand up.
 * A future orchestration layer can still choose to run this alongside the others and
 * reconcile/compare results (that's exactly what CriticAgent is for) without CampaignAgent
 * itself needing to know they exist.
 */
export class CampaignAgent implements AIAgent<CampaignAgentOutput> {
  readonly name = "campaign-agent";
  readonly promptId = "campaign-agent";

  async execute(context: ResearchContext): Promise<AgentResult<CampaignAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["website", "company", "audience", "market", "competitors"] as const;
      const verifiedFacts = await loadVerifiedFacts(context);
      const generalSearch = context.metadata.generalSearch;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          verifiedFacts: verifiedFactsForPrompt(verifiedFacts),
          website: JSON.stringify(context.website ?? {}),
          company: JSON.stringify(context.company ?? {}),
          audience: JSON.stringify(context.audience ?? {}),
          market: JSON.stringify(context.market ?? {}),
          competitors: JSON.stringify(context.competitors ?? {}),
          generalSearch: generalSearch?.narrative ?? "Not available.",
        },
        tool: CAMPAIGN_AGENT_TOOL,
        schema: campaignAgentSchema,
        maxTokens: 1280,
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
            ? [{ source: "crawl-facts", detail: `Strategy grounded in ${verifiedFacts.length} verified facts from the site crawl` }]
            : []),
          ...(generalSearch
            ? [{ source: "general-search", detail: generalSearch.dataSource }]
            : []),
        ],
      };
    });
  }
}
