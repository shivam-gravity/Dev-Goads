import { outageDataSource } from "../../infra/scrapeTypes.js";
import { scrapeUrlWithFallback, sourceLabel } from "../../infra/scrapeFallback.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, SerpFeaturesData } from "../types/index.js";
import { runProviderStep } from "./support.js";
import { buildSearchQuery } from "./searchQuery.js";

const MAX_ITEMS = 8;

/** People Also Ask + Related Searches, from ONE Firecrawl scrape of a live Google SERP —
 * deliberately one provider, not two, since both sections live on the same page; fetching it
 * twice for two separate ResearchContext fields would double the cost for no benefit. Neither
 * Firecrawl's own /search endpoint nor any official API exposes these sections (confirmed against
 * Firecrawl's docs), so this parses them out of the page's own markdown — fragile to Google's
 * markup changes and not something Google's ToS grants, regardless of which tool fetches it.
 * Any parse failure degrades to an empty result, never a thrown error. */
export class GoogleSerpFeaturesProvider implements ResearchProvider<SerpFeaturesData> {
  readonly name = "serp-features";
  readonly priority = 215;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<SerpFeaturesData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = buildSearchQuery(input);
      const scraped = await scrapeUrlWithFallback(`https://www.google.com/search?q=${encodeURIComponent(query)}`, ["markdown"]);
      if (scraped.outage) {
        return { status: "partial", data: { peopleAlsoAsk: [], relatedSearches: [], dataSource: outageDataSource(scraped.outage) } };
      }

      const markdown = scraped.data?.markdown ?? "";
      const peopleAlsoAsk = extractSection(markdown, /people also ask/i).filter((line) => line.endsWith("?")).slice(0, MAX_ITEMS);
      const relatedSearches = extractSection(markdown, /related searches/i).slice(0, MAX_ITEMS);

      const dataSource = sourceLabel(scraped.source, "scrape of a live Google search results page (best-effort — not an officially licensed data source)");
      const data: SerpFeaturesData = { peopleAlsoAsk, relatedSearches, dataSource };
      return { status: peopleAlsoAsk.length > 0 || relatedSearches.length > 0 ? "success" : "partial", data };
    });
  }
}

/** Grabs the markdown lines between a heading matching `sectionHeading` and the next heading
 * (or end of document) — a plain-text heuristic since Firecrawl's markdown conversion doesn't
 * preserve Google's own DOM structure for these sections. */
function extractSection(markdown: string, sectionHeading: RegExp): string[] {
  const lines = markdown.split("\n");
  const startIndex = lines.findIndex((line) => sectionHeading.test(line));
  if (startIndex === -1) return [];

  const collected: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i].replace(/^[#\-*>\s]+/, "").trim();
    if (/^#{1,6}\s/.test(lines[i])) break; // next heading — section ended
    if (line.length > 0 && line.length < 200) collected.push(line);
  }
  return collected;
}
