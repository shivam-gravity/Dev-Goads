import { openai, runWebSearch } from "../../infra/openaiClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { NewsData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep } from "./support.js";

const NO_KEY_DATA_SOURCE = "AI estimate — no live web search performed (OPENAI_API_KEY not set)";
const NO_CITATIONS_DATA_SOURCE = "No recent news coverage found";

/**
 * Recent-news/press-mentions provider — independent of every other provider, framed
 * specifically around recency ("in the last 12 months") so the same runWebSearch
 * primitive SearchProvider/CompanyProvider/etc use returns a distinct kind of result:
 * dated articles with citations, rather than a general/timeless overview.
 */
export class NewsProvider implements ResearchProvider<NewsData> {
  readonly name = "news";
  readonly priority = 90;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<NewsData>> {
    return runProviderStep(this.name, 1, async () => {
      if (!openai) {
        return { status: "partial", data: { articles: [], summary: "", dataSource: NO_KEY_DATA_SOURCE } };
      }

      const label = input.businessName ? `"${input.businessName}" (${input.url})` : input.url;
      const research = await runWebSearch(
        `Find recent news coverage (within the last 12 months) mentioning the business at ${label}: funding, product launches, partnerships, press coverage, or notable events. Summarize what you find.`
      );

      const articles = research.citations.map((c) => ({ title: c.title, url: c.url }));
      const data: NewsData = {
        articles,
        summary: research.narrative,
        dataSource: articles.length > 0 ? "Live web search" : NO_CITATIONS_DATA_SOURCE,
      };
      return {
        status: articles.length > 0 ? "success" : "partial",
        data,
        citations: research.citations,
        evidence: citationsToEvidence(research.citations),
      };
    });
  }
}
