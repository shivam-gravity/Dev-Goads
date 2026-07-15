import { logger } from "../modules/logger/logger.js";
import type { SearchClientResult, SearchResult } from "./searchTypes.js";

function serperApiKey(): string | undefined {
  return process.env.SERPER_API_KEY;
}

const BASE_URL = "https://google.serper.dev";
const REQUEST_TIMEOUT_MS = 15_000;

interface SerperResponse {
  organic?: { title: string; link: string; snippet: string; position: number; date?: string }[];
}

/**
 * Live-verified 2026-07-15 against google.serper.dev/search with a real key — response
 * shape matches SerperResponse exactly. Real Google SERP results, including genuine
 * position — the one thing Tavily/SearXNG don't give (their own relevance ranking, not
 * literal Google rank), which is why this is the default assignment for the
 * "search-ranking" task in searchTaskConfig.ts (SearchRankingProvider derives its
 * `position` field from array order, same as it always has — Serper's order IS real
 * Google order, unlike a relevance-ranked alternative).
 *
 * No native domain-restriction param the way Tavily has include_domains — a caller needing
 * that (SocialMediaProvider, ReviewsProvider) would need to fold `site:` operators into the
 * query string itself if Serper is ever the one serving that task; today both are assigned
 * to Tavily primarily, so this is only a latent gap on Serper's fallback path for them.
 */
export async function serperSearch(query: string, opts?: { num?: number }): Promise<SearchClientResult> {
  const apiKey = serperApiKey();
  if (!apiKey) return { results: [], outage: "no-key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/search`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, ...(opts?.num ? { num: opts.num } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`serperClient: /search responded with ${res.status}`);
      return { results: [], outage: null };
    }
    const json = (await res.json()) as SerperResponse;
    const results: SearchResult[] = (json.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
    return { results, outage: null };
  } catch (err) {
    logger.warn("serperClient: /search failed", err);
    return { results: [], outage: null };
  } finally {
    clearTimeout(timer);
  }
}

export function isSerperConfigured(): boolean {
  return !!serperApiKey();
}
