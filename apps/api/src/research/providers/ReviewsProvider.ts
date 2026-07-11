import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, ReviewsData } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const REVIEWS_TOOL = {
  name: "emit_reviews_analysis",
  description: "Return a structured summary of a business's real customer reviews.",
  input_schema: {
    type: "object" as const,
    properties: {
      averageRating: { type: "string", description: "e.g. \"4.3/5\"" },
      totalReviewsEstimate: { type: "string", description: "e.g. \"~1,200 reviews\"" },
      topPraise: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
      topComplaints: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
      reviewSources: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "e.g. G2, Capterra, Trustpilot, Google Reviews" },
    },
    required: ["topPraise", "topComplaints", "reviewSources"],
  },
};

/** Real customer review/sentiment analysis — independent of every other provider,
 * reasoning from live search of review sites for the target business alone. */
export class ReviewsProvider implements ResearchProvider<ReviewsData> {
  readonly name = "reviews";
  readonly priority = 110;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<ReviewsData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<ReviewsData>({
        maxTokens: 768,
        tool: REVIEWS_TOOL,
        searchPrompt: `Find real customer reviews for the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} on sites like G2, Capterra, Trustpilot, or Google Reviews. What's the average rating, roughly how many reviews, and what do customers praise vs. complain about most?`,
        structurePrompt: (narrative) => `Using this web research, summarize the business's real customer review sentiment.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          topPraise: ["Not yet researched"],
          topComplaints: ["Not yet researched"],
          reviewSources: [],
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
