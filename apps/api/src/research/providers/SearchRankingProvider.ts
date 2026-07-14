import { firecrawlSearch, outageDataSource } from "../../infra/firecrawlClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, SearchRankingData, SearchRankingEntry } from "../types/index.js";
import { runProviderStep } from "./support.js";
import { buildSearchQuery } from "./searchQuery.js";

/** Real SERP rank data via Firecrawl's `/search` — position/title/url for whatever actually
 * ranks today, not an LLM's guess. Derives its own query terms from the business name/hostname
 * rather than reading SEOProvider's keyword list, per ResearchProvider's independence contract. */
export class SearchRankingProvider implements ResearchProvider<SearchRankingData> {
  readonly name = "search-ranking";
  readonly priority = 212;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<SearchRankingData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = buildSearchQuery(input);
      const queries = [query, input.industry ? `${query} ${input.industry}` : undefined].filter((q): q is string => Boolean(q));

      const rankings: SearchRankingEntry[] = [];
      let outageSeen: string | null = null;
      for (const query of queries) {
        const result = await firecrawlSearch(query, { limit: 10, sources: ["web"] });
        if (result.outage) {
          // Keep whatever rankings an earlier query in this loop already collected —
          // an outage on the SECOND query shouldn't discard real results the FIRST query
          // already returned. Only treated as a true outage below if nothing was collected
          // at all across every query.
          outageSeen = outageDataSource(result.outage);
          break;
        }
        result.web.forEach((r, index) => rankings.push({ query, position: index + 1, title: r.title, url: r.url }));
      }

      if (outageSeen && rankings.length === 0) {
        return { status: "partial", data: { rankings: [], dataSource: outageSeen } };
      }

      const data: SearchRankingData = {
        rankings,
        dataSource: rankings.length > 0 ? "Firecrawl live search (Google-indexed organic results)" : "Firecrawl search returned no ranked results",
      };
      return { status: rankings.length > 0 ? "success" : "partial", data };
    });
  }
}
