import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { loadVerifiedFacts, verifiedFactsForPrompt } from "../crawlFacts.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, PricingOfferAgentOutput, ResearchContext } from "../types/index.js";

const PRICING_OFFER_AGENT_TOOL = {
  name: "emit_pricing_offer_agent_result",
  description: "Return the recommended offer/pricing angle for ad campaigns, grounded in competitor and market research.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendedOfferType: { type: "string", description: "e.g. \"Free trial\", \"Limited-time discount\", \"Money-back guarantee\"" },
      pricingPositioning: { type: "string", description: "1-2 sentences: how to position price relative to competitors (premium, value, undercut)" },
      guaranteeOrRiskReversal: { type: "string", description: "A specific risk-reversal angle (guarantee, free returns, no-commitment trial) or 'None recommended' if not applicable" },
      urgencyAngle: { type: "string", description: "A specific, honest urgency/scarcity angle, or 'None recommended' if forcing urgency would feel dishonest" },
    },
    required: ["recommendedOfferType", "pricingPositioning", "guaranteeOrRiskReversal", "urgencyAngle"],
  },
};

const pricingOfferAgentSchema: z.ZodType<PricingOfferAgentOutput> = z.object({
  recommendedOfferType: z.string(),
  pricingPositioning: z.string(),
  guaranteeOrRiskReversal: z.string(),
  urgencyAngle: z.string(),
});

function fallback(): PricingOfferAgentOutput {
  return {
    recommendedOfferType: "Free trial",
    pricingPositioning: "Unknown — no live competitor/market research available.",
    guaranteeOrRiskReversal: "None recommended — insufficient research to ground one.",
    urgencyAngle: "None recommended — insufficient research to ground one.",
  };
}

/** Recommends the actual offer/pricing/guarantee angle for ad campaigns — distinct from
 * BudgetAgent (which sets a $ amount) and CreativeAgent (which writes the copy) — grounded
 * in competitor pricing/positioning and market conditions, independent of every other agent. */
export class PricingOfferAgent implements AIAgent<PricingOfferAgentOutput> {
  readonly name = "pricing-offer-agent";
  readonly promptId = "pricing-offer-agent";

  async execute(context: ResearchContext): Promise<AgentResult<PricingOfferAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["competitors", "market", "funding"] as const;
      const verifiedFacts = await loadVerifiedFacts(context);
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          verifiedFacts: verifiedFactsForPrompt(verifiedFacts),
          competitors: JSON.stringify(context.competitors ?? {}),
          market: JSON.stringify(context.market ?? {}),
          funding: JSON.stringify(context.funding ?? {}),
        },
        tool: PRICING_OFFER_AGENT_TOOL,
        schema: pricingOfferAgentSchema,
        maxTokens: 768,
        fallback,
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        modelSource,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: [
          ...collectEvidence(context, [...fields]),
          ...(verifiedFacts.length > 0
            ? [{ source: "crawl-facts", detail: `Offer grounded in ${verifiedFacts.length} verified facts from the site crawl` }]
            : []),
        ],
      };
    });
  }
}
