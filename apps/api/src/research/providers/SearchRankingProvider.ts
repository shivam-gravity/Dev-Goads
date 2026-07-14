import { firecrawlSearch, outageDataSource } from "../../infra/firecrawlClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, SearchRankingData, SearchRankingEntry } from "../types/index.js";
import { hostnameOf, runProviderStep } from "./support.js";

/** Real SERP rank data via Firecrawl's `/search` — position/title/url for whatever actually
 * ranks today, not an LLM's guess. Derives its own query terms from the business name/hostname
 * rather than reading SEOProvider's keyword list, per ResearchProvider's independence contract. */
export class SearchRankingProvider implements ResearchProvider<SearchRankingData> {
  readonly name = "search-ranking";
  readonly priority = 212;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<SearchRankingData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const businessName = input.businessName ?? hostnameOf(input.url).replace(/^www\./i, "").split(".")[0];
      const queries = [businessName, input.industry ? `${businessName} ${input.industry}` : undefined].filter((q): q is string => Boolean(q));

      const rankings: SearchRankingEntry[] = [];
      let outageSeen: string | null = null;
      for (const query of queries) {
        const result = await firecrawlSearch(query, { limit: 10, sources: ["web"] });
        if (result.outage) {
          outageSeen = outageDataSource(result.outage);
          break;
        }
        result.web.forEach((r, index) => rankings.push({ query, position: index + 1, title: r.title, url: r.url }));
      }

      if (outageSeen) {
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
