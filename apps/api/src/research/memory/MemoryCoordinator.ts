import { createEmbedding } from "../../infra/openaiClient.js";
import { logger } from "../../modules/logger/logger.js";
import {
  findMemoryEntryByDedupKey,
  getMemoryEntryMetadata,
  queryMemory,
  recordMemory,
  updateMemoryEntry,
  type ResearchMemoryMatch,
} from "./ResearchMemoryStore.js";

/**
 * The single write/read path for Research Memory — every Intelligence engine
 * (Competitor, Audience, Creative, Pricing, Market, Landing Page) goes through this
 * instead of calling ResearchMemoryStore/openaiClient.createEmbedding directly, so
 * dedup policy, TTL policy, embedding policy, the metadata schema (every write gets a
 * `dedupKey` field, no exceptions), and audit logging live in exactly ONE place —
 * previously each engine that wrote to Memory (just Competitor Intelligence so far) made
 * these calls independently, which is exactly how policy drifts silently between engines
 * as more of them get built. Storage mechanics (Postgres + app-side cosine similarity,
 * not pgvector) are still ResearchMemoryStore.ts's concern — this file is policy, that
 * file is mechanism.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// One TTL policy: each Intelligence engine's kind gets a horizon matched to how fast that
// KIND of data actually goes stale, not one blanket number — pricing/creative campaigns
// change over weeks, competitor positioning over months. Unmapped/legacy kinds (e.g. the
// pre-MemoryCoordinator "competitor" kind CompetitorProvider still writes) fall back to
// FALLBACK_TTL_MS. None of these are calibrated from real staleness data yet (unlike
// CompetitorProvider's MEMORY_MIN_SCORE or the Competitor Intelligence Engine's citation
// matching, which live runs did calibrate) — revisit each once there's usage data.
const DEFAULT_TTL_BY_KIND: Record<string, number> = {
  "competitor-profile": 180 * DAY_MS,
  competitor: 180 * DAY_MS,
  "audience-profile": 120 * DAY_MS,
  "market-profile": 45 * DAY_MS,
  "pricing-analysis": 30 * DAY_MS,
  // Real ad performance outcomes (campaign-learning-engine.ts) — a longer horizon than any
  // research-derived kind above, since "did this kind of recommendation actually work" is a
  // durable signal, not something that goes stale the way a competitor's pricing page does.
  "campaign-outcome": 270 * DAY_MS,
  "creative-analysis": 90 * DAY_MS,
  "landing-page-analysis": 60 * DAY_MS,
};
const FALLBACK_TTL_MS = 180 * DAY_MS;

export interface MemoryWriteRequest {
  workspaceId: string;
  businessId?: string;
  kind: string;
  sourceUrl: string;
  /** Stable identity for dedup — a competitor name, a landing page URL, or a fixed label
   * like "primary" for a business's own single market/pricing snapshot. Required: every
   * write goes through the same dedup policy, no kind gets to opt out and accumulate
   * duplicate rows every time an engine re-runs against the same entity. */
  dedupKey: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface MemoryReadRequest {
  kind: string;
  queryText: string;
  workspaceId?: string;
  excludeBusinessId?: string;
  topK?: number;
  minScore?: number;
  /** Overrides the kind's default TTL for this read. */
  ttlMs?: number;
}

export interface MemoryWriteResult {
  id: string;
  /** true if an existing entry (same kind+workspace+dedupKey) was refreshed in place;
   * false if this created a new row. */
  deduped: boolean;
}

/** Embeds `content` once, then either refreshes the existing entry matching
 * (kind, workspaceId, dedupKey) or creates a new one — the one dedup policy every
 * Intelligence engine's writes go through. */
export async function writeMemory(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
  const embedding = await createEmbedding(request.content);
  const metadata = { ...request.metadata, dedupKey: request.dedupKey };

  const existing = await findMemoryEntryByDedupKey(request.kind, request.workspaceId, request.dedupKey);
  if (existing) {
    await updateMemoryEntry(existing.id, { content: request.content, metadata, embedding });
    logger.info(`[MemoryCoordinator] updated ${request.kind}/"${request.dedupKey}" (workspace=${request.workspaceId})`);
    return { id: existing.id, deduped: true };
  }

  const [id] = await recordMemory([
    {
      workspaceId: request.workspaceId,
      businessId: request.businessId,
      kind: request.kind,
      sourceUrl: request.sourceUrl,
      content: request.content,
      metadata,
      embedding,
    },
  ]);
  logger.info(`[MemoryCoordinator] created ${request.kind}/"${request.dedupKey}" (workspace=${request.workspaceId})`);
  return { id, deduped: false };
}

/** Embeds `queryText` once, applies the kind's default TTL unless overridden, then
 * delegates to ResearchMemoryStore's similarity search — the one embedding policy and one
 * TTL policy every Intelligence engine's reads go through. */
export async function readMemory(request: MemoryReadRequest): Promise<ResearchMemoryMatch[]> {
  const embedding = await createEmbedding(request.queryText);
  const ttlMs = request.ttlMs ?? DEFAULT_TTL_BY_KIND[request.kind] ?? FALLBACK_TTL_MS;

  const matches = await queryMemory({
    kind: request.kind,
    embedding,
    workspaceId: request.workspaceId,
    excludeBusinessId: request.excludeBusinessId,
    topK: request.topK ?? 5,
    minScore: request.minScore ?? 0.45,
    ttlMs,
  });
  logger.info(`[MemoryCoordinator] read ${request.kind} (workspace=${request.workspaceId ?? "any"}) -> ${matches.length} match(es)`);
  return matches;
}

/** Exact dedupKey lookup, bypassing similarity search — for a caller that needs "does an
 * entry for THIS SPECIFIC entity already exist" (e.g. a drift check against a named
 * competitor) rather than "what's semantically similar to this text." */
export async function findExistingByDedupKey(kind: string, workspaceId: string, dedupKey: string): Promise<{ id: string } | null> {
  return findMemoryEntryByDedupKey(kind, workspaceId, dedupKey);
}

/** Same exact-identity lookup as findExistingByDedupKey, but returns the stored metadata
 * directly — the common case for a drift/"what did we previously record" check, so
 * callers never need to reach past the coordinator into ResearchMemoryStore/Prisma just
 * to read one entry's metadata back. */
export async function getMetadataByDedupKey(kind: string, workspaceId: string, dedupKey: string): Promise<Record<string, unknown> | undefined> {
  return getMemoryEntryMetadata(kind, workspaceId, dedupKey);
}
