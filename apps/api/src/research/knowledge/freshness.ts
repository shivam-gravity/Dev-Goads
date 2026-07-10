/**
 * Shared freshness/TTL math — used by KnowledgeFusionEngine (explainability metadata on
 * a ResearchContext) and ResearchMemoryStore (decaying/expiring retrieved memory). One
 * small pure module rather than duplicated logic in both, since "how stale is this
 * timestamp relative to a TTL" is exactly the same question in both places.
 */

/**
 * Linear decay from 1 (just captured) to 0 (at/past the TTL) — deliberately not
 * exponential: a simple, predictable curve is easier to reason about and tune than a
 * decay constant nobody has real data to calibrate yet (see CompetitorProvider's
 * MEMORY_MIN_SCORE comment for what happens when a threshold IS calibrated from real
 * data — this one isn't yet, so it stays simple until it is).
 */
export function freshnessScore(timestamp: string | Date, ttlMs: number): number {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (ageMs <= 0) return 1;
  if (ageMs >= ttlMs) return 0;
  return Math.round((1 - ageMs / ttlMs) * 100) / 100;
}

export function isStale(timestamp: string | Date, ttlMs: number): boolean {
  return freshnessScore(timestamp, ttlMs) <= 0;
}
