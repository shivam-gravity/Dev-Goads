import type { SearchAssignment, SearchProvider } from "./searchRouter.js";

/**
 * Task -> search-provider assignment, same resolution shape as llmTaskConfig.ts
 * (env override -> static registry -> default) but for the 3 search backends that replaced
 * Firecrawl's /search (its account hit its credit limit — see infra/searchRouter.ts).
 *
 * Only one task actually needs a non-default assignment today:
 *  - "search-ranking" (SearchRankingProvider) needs genuine Google SERP order to derive a
 *    real `position` field — Serper is the only one of the three that returns actual
 *    Google-ranked results; Tavily/SearXNG apply their own relevance ranking instead.
 * Everything else (the general "web-research" task every webSearchThenStructure-based
 * provider and Intelligence Engine shares, plus SocialMediaProvider/ReviewsProvider's
 * domain-scoped searches) is well served by Tavily's LLM-optimized content extraction —
 * DEFAULT_ASSIGNMENT covers all of it; no per-provider entries needed unless that changes.
 */
const DEFAULT_ASSIGNMENT: SearchAssignment = { provider: "tavily" };

const TASK_SEARCH_REGISTRY: Record<string, SearchAssignment> = {
  "search-ranking": { provider: "serper" },
};

const VALID_PROVIDERS = new Set<string>(["tavily", "serper", "searxng"]);

/**
 * Resolution order: per-task env override (quick experiments, no code change) → static
 * registry (checked-in, deliberate) → global default. Env var format:
 * `SEARCH_TASK_<TASK_NAME>="provider"`, e.g. `SEARCH_TASK_SEARCH_RANKING="tavily"`.
 * A malformed/unrecognized override is ignored rather than thrown — falls through to the
 * static registry/default instead.
 */
export function resolveSearchTask(taskName: string): SearchAssignment {
  const envKey = `SEARCH_TASK_${taskName.toUpperCase().replace(/-/g, "_")}`;
  const envOverride = process.env[envKey];
  if (envOverride && VALID_PROVIDERS.has(envOverride)) {
    return { provider: envOverride as SearchProvider };
  }
  return TASK_SEARCH_REGISTRY[taskName] ?? DEFAULT_ASSIGNMENT;
}
