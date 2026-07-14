import { logger } from "../../modules/logger/logger.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { AutocompleteData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { hostnameOf, runProviderStep, withTimeout } from "./support.js";

const FETCH_TIMEOUT_MS = 6000;
const DATA_SOURCE = "Google Autocomplete (unofficial public suggest endpoint, best-effort)";

/** No Firecrawl/OpenAI dependency at all — Google's suggest endpoint is a free, unauthenticated
 * JSON API widely relied on by other open-source tools, just not an officially documented one.
 * Labeled honestly as best-effort in dataSource; any failure degrades to an empty list rather
 * than throwing, since Google could change or block this at any time without notice. */
export class AutocompleteProvider implements ResearchProvider<AutocompleteData> {
  readonly name = "autocomplete";
  readonly priority = 214;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<AutocompleteData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = input.businessName ?? hostnameOf(input.url).replace(/^www\./i, "").split(".")[0];
      const suggestions = await fetchSuggestions(query);
      const data: AutocompleteData = { suggestions, dataSource: DATA_SOURCE };
      return { status: suggestions.length > 0 ? "success" : "partial", data };
    });
  }
}

async function fetchSuggestions(query: string): Promise<string[]> {
  try {
    const res = await withTimeout(
      fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`),
      FETCH_TIMEOUT_MS,
      "Google Autocomplete"
    );
    if (!res.ok) return [];
    const json = (await res.json()) as [string, string[]];
    return Array.isArray(json?.[1]) ? json[1].slice(0, 10) : [];
  } catch (err) {
    logger.warn(`AutocompleteProvider: suggest request failed for "${query}"`, err);
    return [];
  }
}
