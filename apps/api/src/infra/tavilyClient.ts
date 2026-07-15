import { logger } from "../modules/logger/logger.js";
import type { SearchClientResult, SearchResult } from "./searchTypes.js";

// Read fresh on every call, not frozen as a module-scope const — see firecrawlClient.ts's
// firecrawlApiKey() for why (this module is a singleton across an entire `npm test` run).
function tavilyApiKey(): string | undefined {
  return process.env.TAVILY_API_KEY;
}

const BASE_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 15_000;

interface TavilyResponse {
  results?: { title: string; url: string; content: string }[];
}

/**
 * Live-verified 2026-07-15 against api.tavily.com/search with a real key — response shape
 * matches TavilyResponse exactly. Purpose-built for feeding an LLM real web content
 * (clean extracted text + relevance score per result), which is why this is the default
 * assignment for general research tasks in searchTaskConfig.ts.
 */
export async function tavilySearch(query: string, opts?: { maxResults?: number; includeDomains?: string[] }): Promise<SearchClientResult> {
  const apiKey = tavilyApiKey();
  if (!apiKey) return { results: [], outage: "no-key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: opts?.maxResults ?? 5,
        ...(opts?.includeDomains ? { include_domains: opts.includeDomains } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`tavilyClient: /search responded with ${res.status}`);
      return { results: [], outage: null };
    }
    const json = (await res.json()) as TavilyResponse;
    const results: SearchResult[] = (json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    return { results, outage: null };
  } catch (err) {
    logger.warn("tavilyClient: /search failed", err);
    return { results: [], outage: null };
  } finally {
    clearTimeout(timer);
  }
}

export function isTavilyConfigured(): boolean {
  return !!tavilyApiKey();
}
