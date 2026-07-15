import { logger } from "../modules/logger/logger.js";
import type { SearchClientResult, SearchResult } from "./searchTypes.js";

// No API key model — self-hosted, reachable only on this platform's own network. "Not
// configured" here means SEARXNG_BASE_URL isn't set (e.g. no instance deployed yet in this
// environment), not a missing credential — same "no-key" outage value is reused since
// every caller already handles that value identically (skip, try the next tier).
function searxngBaseUrl(): string | undefined {
  return process.env.SEARXNG_BASE_URL;
}

const REQUEST_TIMEOUT_MS = 20_000; // aggregates several upstream engines itself — give it more room than a single hosted API

interface SearxngResponse {
  results?: { title: string; url: string; content?: string }[];
}

/**
 * Live-verified 2026-07-15 against a real self-hosted instance (docker-compose.yml's
 * `searxng` service + searxng/settings.yml's JSON format + disabled limiter) — a real
 * query returned genuine aggregated results (Brave, Google CSE, Startpage engines) in
 * exactly the shape this client expects (`results[].{title,url,content}`).
 *
 * Last-resort tier in searchTaskConfig.ts's fallback chain — deliberately last, not first:
 * self-hosted + scraping public search engines on our behalf carries real reliability risk
 * (upstream anti-bot defenses) that Tavily/Serper, as paid API vendors, don't have. Rarely
 * reached in practice is a feature here, not a limitation — lower volume means lower
 * detection/blocking risk for the instance.
 */
export async function searxngSearch(query: string, opts?: { maxResults?: number }): Promise<SearchClientResult> {
  const base = searxngBaseUrl();
  if (!base) return { results: [], outage: "no-key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = new URL("/search", base);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      logger.warn(`searxngClient: /search responded with ${res.status}`);
      return { results: [], outage: null };
    }
    const json = (await res.json()) as SearxngResponse;
    const results: SearchResult[] = (json.results ?? [])
      .slice(0, opts?.maxResults ?? 5)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
    return { results, outage: null };
  } catch (err) {
    logger.warn("searxngClient: /search failed or instance unreachable", err);
    return { results: [], outage: null };
  } finally {
    clearTimeout(timer);
  }
}

export function isSearxngConfigured(): boolean {
  return !!searxngBaseUrl();
}
