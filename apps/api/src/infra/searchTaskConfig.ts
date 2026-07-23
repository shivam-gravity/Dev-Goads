import type { SearchAssignment, SearchProvider } from "./searchRouter.js";

/**
 * Task -> search-provider assignment. Since Tavily and Serper were removed, SearXNG is the
 * only backend, so every task resolves to it. The env-override mechanism is kept (harmless,
 * and lets a future provider be slotted back in without a code change), but with a single
 * valid provider it can only ever re-select SearXNG today.
 *
 * `search-ranking` (SearchRankingProvider) previously used Serper for genuine Google SERP
 * order; SearXNG applies its own relevance ranking, so that provider's `position` field is now
 * approximate (relevance-ranked) rather than exact Google rank. That trade-off is intentional —
 * no metered search vendor remains.
 */
const DEFAULT_ASSIGNMENT: SearchAssignment = { provider: "searxng" };

const TASK_SEARCH_REGISTRY: Record<string, SearchAssignment> = {};

const VALID_PROVIDERS = new Set<string>(["searxng"]);

/**
 * Resolution order: per-task env override (quick experiments, no code change) → static
 * registry (checked-in, deliberate) → global default. Env var format:
 * `SEARCH_TASK_<TASK_NAME>="provider"`, e.g. `SEARCH_TASK_WEB_RESEARCH="searxng"`.
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
