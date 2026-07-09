import { openai, runStructured } from "../openaiClient.js";
import type { AdCopyVariant, CampaignSuggestion, NormalizedProduct } from "../types.js";

const NETWORKS = ["meta", "google", "tiktok"] as const;

const CAMPAIGN_TOOL = {
  name: "emit_campaign_suggestion",
  description: "Return a recommended ad campaign structure (networks, budget split, target audiences) for this product.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendedNetworks: {
        type: "array",
        items: { type: "string", enum: NETWORKS },
        minItems: 1,
        maxItems: NETWORKS.length,
      },
      budgetSplit: {
        type: "object",
        description: "Fraction of budget per recommended network, summing to 1",
        properties: { meta: { type: "number" }, google: { type: "number" }, tiktok: { type: "number" } },
      },
      audiences: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      rationale: { type: "string", description: "1-2 sentences on why this structure fits the product" },
    },
    required: ["recommendedNetworks", "budgetSplit", "audiences", "rationale"],
  },
};

function fallbackCampaignSuggestion(): CampaignSuggestion {
  return {
    recommendedNetworks: ["meta"],
    budgetSplit: { meta: 1 },
    audiences: ["General interest shoppers"],
    rationale: "Default single-network suggestion — set OPENAI_API_KEY for tailored recommendations.",
  };
}

/** Falls back to a generic single-network suggestion if OPENAI_API_KEY is unset. */
export async function suggestCampaign(product: NormalizedProduct, adCopy: AdCopyVariant[]): Promise<CampaignSuggestion> {
  if (!openai) return fallbackCampaignSuggestion();

  const result = await runStructured<CampaignSuggestion>({
    maxTokens: 1024,
    tool: CAMPAIGN_TOOL,
    messages: [
      {
        role: "user",
        content: `Recommend an ad campaign structure for this product: which networks to run on, how to split budget between them (as fractions summing to 1), and which target audiences to use.

Product:
${JSON.stringify(product, null, 2)}

Ad copy already generated for it:
${JSON.stringify(adCopy, null, 2)}`,
      },
    ],
  });
  if (!result) throw new Error("Campaign suggestion: model did not return structured output");
  return result;
}
