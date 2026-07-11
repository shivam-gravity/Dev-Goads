import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, LandingPageAgentOutput, ResearchContext } from "../types/index.js";

const LANDING_PAGE_AGENT_TOOL = {
  name: "emit_landing_page_agent_result",
  description: "Return landing-page copy/CTA recommendations grounded in the scraped page and the audience research.",
  input_schema: {
    type: "object" as const,
    properties: {
      heroClarity: { type: "string", description: "1-2 sentences: is the above-the-fold value proposition immediately clear? What's unclear if not?" },
      ctaRecommendation: { type: "string", description: "A specific, concrete call-to-action recommendation for the landing page" },
      messagingMismatches: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "Ways the page's stated message doesn't match what the audience research says they care about" },
      recommendedFixes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    },
    required: ["heroClarity", "ctaRecommendation", "messagingMismatches", "recommendedFixes"],
  },
};

const landingPageAgentSchema: z.ZodType<LandingPageAgentOutput> = z.object({
  heroClarity: z.string(),
  ctaRecommendation: z.string(),
  messagingMismatches: z.array(z.string()),
  recommendedFixes: z.array(z.string()),
});

function fallback(): LandingPageAgentOutput {
  return {
    heroClarity: "Unknown — no live research available to assess the landing page.",
    ctaRecommendation: "Use a single, specific action verb (e.g. \"Start free trial\") above the fold.",
    messagingMismatches: [],
    recommendedFixes: ["Re-run once website/audience research is available"],
  };
}

/** Reviews the scraped landing page (WebsiteProvider's output) against the audience
 * research for hero-copy clarity, CTA strength, and message-audience fit — independent
 * of every other agent. */
export class LandingPageAgent implements AIAgent<LandingPageAgentOutput> {
  readonly name = "landing-page-agent";
  readonly promptId = "landing-page-agent";

  async execute(context: ResearchContext): Promise<AgentResult<LandingPageAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["website", "audience"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          website: JSON.stringify(context.website ?? {}),
          audience: JSON.stringify(context.audience ?? {}),
        },
        tool: LANDING_PAGE_AGENT_TOOL,
        schema: landingPageAgentSchema,
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
