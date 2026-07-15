import { logger } from "../modules/logger/logger.js";
import type { SearchClientResult, SearchResult } from "./searchTypes.js";

// Read fresh on every call, not frozen as a module-scope const — see firecrawlClient.ts's
// firecrawlApiKey() for why (this module is a singleton across an entire `npm test` run).
function tavilyApiKey(): string | undefined {
  return process.env.TAVILY_API_KEY;
}

const BASE_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 15_000;

// Tavily hard-rejects with a 400 ("Query is too long. Max query length is 400 characters.")
// above this — confirmed live 2026-07-15. Callers here (runWebSearch et al.) pass full
// instructional research sentences, not short keywords, and several routinely run 450+
// chars, so this isn't a rare edge case — without truncation, Tavily (this codebase's
// first-tier/default search vendor) 400s on most real research prompts and every one of
// those calls silently falls through to Serper, wasting the round-trip and never actually
// using the vendor it's configured to prefer.
const MAX_QUERY_LENGTH = 400;

interface TavilyResponse {
  results?: { title: string; url: string; content: string }[];
}

/** Truncates at the last whitespace boundary at or before the limit so we don't cut a word
 * in half — Tavily still searches fine on a shortened-but-coherent query. */
function truncateQuery(query: string): string {
  if (query.length <= MAX_QUERY_LENGTH) return query;
  const truncated = query.slice(0, MAX_QUERY_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim();
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

  const effectiveQuery = truncateQuery(query);
  if (effectiveQuery.length < query.length) {
    logger.warn(`tavilyClient: query truncated from ${query.length} to ${effectiveQuery.length} chars (Tavily's 400-char limit)`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: effectiveQuery,
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
