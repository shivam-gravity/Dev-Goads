import { llm, runWebSearch } from "../../infra/llmClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { GeneralSearchData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, hostnameOf, runProviderStep } from "./support.js";
import { TtlCache, normalizeCacheKey } from "../cache/TtlCache.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new TtlCache<{ narrative: string; citations: { url: string; title: string }[]; searchesUsed: number }>(CACHE_TTL_MS);

const NO_KEY_DATA_SOURCE = "AI estimate — live web search returned no usable results";

/**
 * General-purpose live web-search provider — reuses the existing runWebSearch primitive
 * (infra/openaiClient.ts, gpt-4o-search-preview) rather than a second search integration.
 * Its narrative/citations don't map to one of ResearchContext's named fields; the
 * Knowledge Aggregator folds this into `metadata.generalSearch` as cross-cutting
 * supporting evidence for the other 8 providers instead.
 */
export class SearchProvider implements ResearchProvider<GeneralSearchData> {
  readonly name = "search";
  readonly priority = 20;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<GeneralSearchData>> {
    return runProviderStep(this.name, 1, input, async () => {
      if (!llm) {
        return { status: "partial", data: { narrative: "", searchesUsed: 0, dataSource: NO_KEY_DATA_SOURCE } };
      }

      const host = hostnameOf(input.url);
      const cacheKey = normalizeCacheKey(`general:${host}`);
      const cached = cache.get(cacheKey);
      const result =
        cached ??
        (await runWebSearch(
          `Give a concise, sourced overview of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""}: what it does, ` +
            `who it serves, and any notable recent developments. Cite real sources.`
        ));
      if (!cached) cache.set(cacheKey, result);

      const citations = result.citations;
      const data: GeneralSearchData = {
        narrative: result.narrative,
        searchesUsed: result.searchesUsed,
        dataSource: citations.length > 0 ? citations.map((c) => c.title).join(" + ") : NO_KEY_DATA_SOURCE,
      };
      return { status: result.narrative ? "success" : "partial", data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
