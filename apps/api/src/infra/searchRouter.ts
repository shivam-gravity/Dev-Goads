import { logger } from "../modules/logger/logger.js";
import * as tavily from "./tavilyClient.js";
import * as serper from "./serperClient.js";
import * as searxng from "./searxngClient.js";
import type { SearchResult } from "./searchTypes.js";

/**
 * Provider-aware dispatch across all three search backends — same shape as llmRouter.ts's
 * groq/mistral/ollama/google dispatch, one task-config assignment tried first, falling
 * through a fixed-order chain on failure/empty. Replaces firecrawlClient.ts's /search
 * (account hit its credit limit — see searchTaskConfig.ts's doc comment for the vendor
 * choice reasoning).
 */

export type SearchProvider = "tavily" | "serper" | "searxng";
export interface SearchAssignment {
  provider: SearchProvider;
}

const CLIENTS = {
  tavily,
  serper,
  searxng,
};

// Tried in order (skipping whatever was already attempted as the primary assignment).
// Searxng deliberately last — see searxngClient.ts's doc comment on why lower volume there
// is a feature, not a limitation.
const FALLBACK_CHAIN: SearchProvider[] = ["tavily", "serper", "searxng"];

const HOSTED_TIMEOUT_MS = 15_000;
const SEARXNG_TIMEOUT_MS = 20_000;

function timeoutFor(provider: SearchProvider): number {
  return provider === "searxng" ? SEARXNG_TIMEOUT_MS : HOSTED_TIMEOUT_MS;
}

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

async function callProvider(provider: SearchProvider, query: string, opts: SearchOpts): Promise<SearchResult[]> {
  if (provider === "tavily") {
    const { results } = await tavily.tavilySearch(query, { maxResults: opts.maxResults, includeDomains: opts.includeDomains });
    return results;
  }
  if (provider === "serper") {
    // No native domain-restriction — see serperClient.ts's doc comment.
    const { results } = await serper.serperSearch(query, { num: opts.maxResults });
    return results;
  }
  const { results } = await searxng.searxngSearch(query, { maxResults: opts.maxResults });
  return results;
}

async function tryChain(query: string, opts: SearchOpts, alreadyTried: SearchProvider | null): Promise<SearchRunResult> {
  for (const provider of FALLBACK_CHAIN) {
    if (provider === alreadyTried) continue;
    try {
      const results = await raceWithTimeout(callProvider(provider, query, opts), timeoutFor(provider));
      if (results.length > 0) return { results, source: provider, searchesUsed: 1 };
      logger.warn(`searchRouter: fallback provider ${provider} produced no usable results`);
    } catch (err) {
      logger.warn(`searchRouter: fallback provider ${provider} failed`, err);
    }
  }
  return { results: [], source: alreadyTried ?? FALLBACK_CHAIN[0], searchesUsed: 0 };
}

export async function runSearch(assignment: SearchAssignment, query: string, opts: SearchOpts = {}): Promise<SearchRunResult> {
  try {
    const results = await raceWithTimeout(callProvider(assignment.provider, query, opts), timeoutFor(assignment.provider));
    if (results.length > 0) return { results, source: assignment.provider, searchesUsed: 1 };
    logger.warn(`searchRouter: ${assignment.provider} produced no usable results — falling back`);
  } catch (err) {
    logger.warn(`searchRouter: ${assignment.provider} failed — falling back`, err);
  }

  return tryChain(query, opts, assignment.provider);
}
