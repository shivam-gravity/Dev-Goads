import { llm, runWebSearch } from "../../infra/llmClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { GeneralSearchData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, factGroundingScore, hostnameOf, runProviderStep } from "./support.js";
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

      // Fact-first fallback: when the live web search comes back empty (the self-hosted backend
      // often does for a niche B2B site), fold the up-front verified facts + site excerpt into the
      // overview narrative instead of returning nothing (which scored ~0.05 and dragged the
      // aggregate). This provider is cross-cutting supporting evidence, so a grounded, fact-based
      // overview is exactly the "what it does / who it serves" summary it's meant to supply.
      if (!result.narrative && (input.verifiedFacts?.length || input.websiteExcerpt)) {
        const factsText = input.verifiedFacts?.length
          ? input.verifiedFacts.slice(0, 30).map((f) => `- ${f.field}: ${f.value}`).join("\n")
          : "";
        const narrative = [
          `Overview grounded in the business's own website${input.businessName ? ` ("${input.businessName}")` : ""}:`,
          factsText,
          input.websiteExcerpt ? input.websiteExcerpt.slice(0, 1500) : "",
        ].filter(Boolean).join("\n\n");
        const factCitation = [{ url: input.url, title: `Verified from ${hostnameOf(input.url)}` }];
        return {
          status: "success",
          data: { narrative, searchesUsed: result.searchesUsed, dataSource: `Grounded in ${input.verifiedFacts?.length ?? 0} verified facts from the site` },
          citations: factCitation,
          evidence: citationsToEvidence(factCitation),
          // Score by the fact base backing this overview (shared floor + quality bonus), consistent
          // with the other fact-first providers — replaces the old flat 0.7 that ignored how many
          // facts actually grounded it. A pure excerpt-only fallback (no facts) still earns the floor.
          confidence: factGroundingScore(input.verifiedFacts ?? []),
        };
      }

      const data: GeneralSearchData = {
        narrative: result.narrative,
        searchesUsed: result.searchesUsed,
        dataSource: citations.length > 0 ? citations.map((c) => c.title).join(" + ") : NO_KEY_DATA_SOURCE,
      };
      return { status: result.narrative ? "success" : "partial", data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
