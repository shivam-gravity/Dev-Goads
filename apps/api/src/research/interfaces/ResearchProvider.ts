import type { ProviderResult, ResearchProviderInput } from "../types/index.js";

/**
 * The contract every research provider implements. `priority` is a reporting/ordering
 * hint only (lower runs "first" in progress logs) — it does NOT create a dependency
 * order. The orchestrator always runs every provider concurrently via Promise.allSettled;
 * a provider must be able to produce ProviderResult<T> from ResearchProviderInput alone,
 * never from another provider's result, so the set of providers can grow/shrink without
 * anyone having to reason about execution order.
 */
export interface ResearchProvider<T> {
  readonly name: string;
  readonly priority: number;
  execute(input: ResearchProviderInput): Promise<ProviderResult<T>>;
}
