import { logger } from "../modules/logger/logger.js";
import * as searxng from "./searxngClient.js";
import type { SearchResult } from "./searchTypes.js";

/**
 * Single-backend web search over the self-hosted SearXNG instance. Tavily and Serper (paid
 * per-call vendors) were removed entirely — every search task now runs through SearXNG, which
 * is self-hosted (docker-compose.yml's `searxng` service) and has no per-call quota, so
 * research fan-out no longer burns a metered credit budget.
 *
 * The public shape (SearchAssignment/runSearch/SearchRunResult) is deliberately unchanged from
 * the old multi-provider router so every call site (llmClient.runWebSearch, the research
 * providers, the Intelligence Engines) keeps working without edits. `provider` is now a
 * single-member union rather than a real routing choice.
 */

export type SearchProvider = "searxng";
export interface SearchAssignment {
  provider: SearchProvider;
}

const SEARXNG_TIMEOUT_MS = 20_000;

/** Soft timeout — stops waiting, doesn't necessarily cancel the underlying request. Same
 * pattern as llmRouter.ts's raceWithTimeout. */
function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Search call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export interface SearchOpts {
  maxResults?: number;
  includeDomains?: string[];
}

export interface SearchRunResult {
  results: SearchResult[];
  source: SearchProvider;
  searchesUsed: number;
}

/**
 * SearXNG has no structured domain-restriction parameter (Tavily's `include_domains` had no
 * equivalent), so domain scoping is expressed the way public search engines accept it: as
 * `site:` operators appended to the query. Multiple domains become an OR group so a
 * ReviewsProvider/SocialMediaProvider search still stays within its allowed sites.
 */
function applyDomainScope(query: string, includeDomains?: string[]): string {
  if (!includeDomains || includeDomains.length === 0) return query;
  const scope = includeDomains.map((d) => `site:${d}`).join(" OR ");
  return `${query} (${scope})`;
}

async function callSearxng(query: string, opts: SearchOpts): Promise<SearchResult[]> {
  const scopedQuery = applyDomainScope(query, opts.includeDomains);
  const { results } = await searxng.searxngSearch(scopedQuery, { maxResults: opts.maxResults });
  return results;
}

/**
 * `assignment` is retained only for call-site compatibility — there is a single backend now,
 * so it's always SearXNG regardless of the assignment. Degrades to an empty result set
 * (searchesUsed: 0) rather than throwing when the instance is down/unreachable, exactly as the
 * old router did, so a search outage never crashes a research run.
 */
export async function runSearch(_assignment: SearchAssignment, query: string, opts: SearchOpts = {}): Promise<SearchRunResult> {
  try {
    const results = await raceWithTimeout(callSearxng(query, opts), SEARXNG_TIMEOUT_MS);
    if (results.length > 0) return { results, source: "searxng", searchesUsed: 1 };
    logger.warn("searchRouter: searxng produced no usable results");
  } catch (err) {
    logger.warn("searchRouter: searxng search failed or instance unreachable", err);
  }
  return { results: [], source: "searxng", searchesUsed: 0 };
}
