import { runSearch } from "../../infra/searchRouter.js";
import { resolveSearchTask } from "../../infra/searchTaskConfig.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, SearchRankingData, SearchRankingEntry } from "../types/index.js";
import { runProviderStep } from "./support.js";
import { buildSearchQuery } from "./searchQuery.js";

/** Real SERP rank data via searchRouter's "search-ranking" task (Serper by default — the
 * only one of the three search vendors that returns genuine Google-ranked order, which is
 * what `position` below is derived from) — position/title/url for whatever actually ranks
 * today, not an LLM's guess. Derives its own query terms from the business name/hostname
 * rather than reading SEOProvider's keyword list, per ResearchProvider's independence
 * contract. Previously Firecrawl's `/search` — replaced after that account hit its credit
 * limit (see infra/searchRouter.ts). */
export class SearchRankingProvider implements ResearchProvider<SearchRankingData> {
  readonly name = "search-ranking";
  readonly priority = 212;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<SearchRankingData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = buildSearchQuery(input);
      const queries = [query, input.industry ? `${query} ${input.industry}` : undefined].filter((q): q is string => Boolean(q));

      const assignment = resolveSearchTask("search-ranking");
      const rankings: SearchRankingEntry[] = [];
      let source: string | null = null;
      for (const query of queries) {
        // Keep whatever rankings an earlier query in this loop already collected — a
        // failure on the SECOND query shouldn't discard real results the FIRST query
        // already returned; only stop the loop if this query itself found nothing at all.
        const result = await runSearch(assignment, query, { maxResults: 10 });
        if (result.searchesUsed === 0) break;
        source = result.source;
        result.results.forEach((r, index) => rankings.push({ query, position: index + 1, title: r.title, url: r.url }));
      }

      const data: SearchRankingData = {
        rankings,
        dataSource: rankings.length > 0 ? `${source} live search (Google-indexed organic results)` : "Live search returned no ranked results",
      };
      return { status: rankings.length > 0 ? "success" : "partial", data };
    });
  }
}
