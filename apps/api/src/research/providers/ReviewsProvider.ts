import { firecrawlScrape, firecrawlSearch } from "../../infra/firecrawlClient.js";
import { runStructured } from "../../infra/openaiClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, ReviewsData } from "../types/index.js";
import { citationsToEvidence, hostnameOf, runProviderStep, webSearchThenStructure } from "./support.js";

const REVIEW_SITES = ["g2.com", "capterra.com", "trustradius.com"];
const MAX_PROFILES = 3;
const MAX_EXCERPT_LENGTH = 2500;

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

/**
 * Real review-site crawl first (Firecrawl search scoped to G2/Capterra/TrustRadius + scrape of
 * the business's actual profile page(s), so praise/complaints come from verbatim review text),
 * falling back to the original pure-LLM-web-search behavior when no real profile is found or
 * Firecrawl isn't configured — same field/shape either way, so nothing downstream changes.
 */
export class ReviewsProvider implements ResearchProvider<ReviewsData> {
  readonly name = "reviews";
  readonly priority = 110;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<ReviewsData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = input.businessName ?? hostnameOf(input.url).replace(/^www\./i, "").split(".")[0];
      const grounded = await this.fromRealReviewSites(query);
      if (grounded) return grounded;

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

  private async fromRealReviewSites(query: string): Promise<{ status: "success" | "partial"; data: ReviewsData; evidence: { url: string; title?: string }[] } | null> {
    const searchResult = await firecrawlSearch(query, { includeDomains: REVIEW_SITES, limit: MAX_PROFILES });
    if (searchResult.outage || searchResult.web.length === 0) return null;

    const excerpts: string[] = [];
    const evidence: { url: string; title?: string }[] = [];
    for (const profile of searchResult.web.slice(0, MAX_PROFILES)) {
      const scraped = await firecrawlScrape(profile.url, ["markdown"]);
      if (scraped.outage) break;
      if (scraped.data?.markdown) {
        excerpts.push(`### ${profile.title}\n${profile.url}\n${scraped.data.markdown.slice(0, MAX_EXCERPT_LENGTH)}`);
        evidence.push({ url: profile.url, title: profile.title });
      }
    }
    if (excerpts.length === 0) return null;

    const structured = await runStructured<Omit<ReviewsData, "dataSource">>({
      maxTokens: 768,
      tool: REVIEWS_TOOL,
      messages: [{ role: "user", content: `Summarize real customer review sentiment for "${query}" from these actual review-site page excerpts:\n\n${excerpts.join("\n\n")}` }],
    }).catch(() => null);
    if (!structured) return null;

    const data: ReviewsData = { ...structured, dataSource: `Firecrawl crawl of real review profiles (${evidence.map((e) => hostnameOf(e.url)).join(", ")})` };
    return { status: "success", data, evidence };
  }
}
