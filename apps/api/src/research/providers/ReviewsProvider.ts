import { crawl4aiScrape } from "../../infra/crawl4aiClient.js";
import { runSearch } from "../../infra/searchRouter.js";
import { resolveSearchTask } from "../../infra/searchTaskConfig.js";
import { runStructured } from "../../infra/llmClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, ReviewsData } from "../types/index.js";
import { citationsToEvidence, hostnameOf, NO_CITATIONS_DATA_SOURCE, NO_SEARCH_DATA_SOURCE, runProviderStep, webSearchThenStructure } from "./support.js";
import { buildSearchQuery } from "./searchQuery.js";

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
 * A general web-research pass first (via llmClient.ts's runWebSearch), falling back to a
 * real review-site crawl (searchRouter's "reviews-search" task, scoped to
 * G2/Capterra/TrustRadius via includeDomains, + a Firecrawl scrape of the business's actual
 * profile page(s), so praise/complaints come from verbatim review text) only when the
 * web-search leg didn't produce grounded results — same field/shape either way, so nothing
 * downstream changes regardless of which leg served the result.
 */
export class ReviewsProvider implements ResearchProvider<ReviewsData> {
  readonly name = "reviews";
  readonly priority = 110;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<ReviewsData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = buildSearchQuery(input);

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

      const isFallback = data.dataSource === NO_SEARCH_DATA_SOURCE || data.dataSource === NO_CITATIONS_DATA_SOURCE;
      if (isFallback) {
        const grounded = await this.fromRealReviewSites(query);
        if (grounded) return grounded;
      }

      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }

  private async fromRealReviewSites(query: string): Promise<{ status: "success" | "partial"; data: ReviewsData; evidence: { url: string; title?: string }[] } | null> {
    const assignment = resolveSearchTask("reviews-search");
    const searchResult = await runSearch(assignment, query, { includeDomains: REVIEW_SITES, maxResults: MAX_PROFILES });
    if (searchResult.searchesUsed === 0) return null;

    const excerpts: string[] = [];
    const evidence: { url: string; title?: string }[] = [];
    for (const profile of searchResult.results.slice(0, MAX_PROFILES)) {
      const scraped = await crawl4aiScrape(profile.url, ["markdown"]);
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

    const data: ReviewsData = { ...structured, dataSource: `Real review profiles (${evidence.map((e) => hostnameOf(e.url)).join(", ")})` };
    return { status: "success", data, evidence };
  }
}
