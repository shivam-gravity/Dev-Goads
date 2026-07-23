import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { freshnessScore } from "../knowledge/freshness.js";

/**
 * Research Memory (RAG store) — persists embedded research findings so a later job can
 * retrieve semantically similar past findings instead of only ever starting from a blank
 * live web search. Currently backs Competitor Intelligence (see
 * research/providers/CompetitorProvider.ts): retrieval augments the search/structure
 * prompts with what similar businesses' research already found; write happens after a
 * successful (non-fallback) result so future jobs can retrieve it.
 *
 * Storage note: this is a plain-Postgres, application-side-cosine-similarity
 * implementation, NOT pgvector — this Postgres instance (a native Windows install) doesn't
 * have the pgvector extension available, and installing a native extension binary into a
 * shared system Postgres install is out of scope for an automated change. `queryMemory`
 * fetches candidate rows (filtered by kind/workspace, capped by MAX_CANDIDATES) and scores
 * them in JS — correct and fast enough at this table's expected size. If/when pgvector is
 * installed, the swap is confined to this file: change ResearchMemoryEntry.embedding to
 * `Unsupported("vector(1536)")`, replace queryMemory's Prisma findMany + in-JS ranking with
 * a `$queryRaw` ANN query (ivfflat/hnsw), and keep recordMemory/queryMemory's exported
 * signatures identical so CompetitorProvider (or any future caller) needs no changes.
 */

export interface ResearchMemoryRecord {
  workspaceId: string;
  businessId?: string;
  kind: string;
  sourceUrl: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
}

export interface ResearchMemoryMatch {
  id: string;
  /** Raw cosine similarity — unaffected by age. */
  similarity: number;
  /** 0-1, decays linearly to 0 at ttlMs (see freshness.ts). 1 for a just-written entry. */
  freshness: number;
  /** similarity * freshness — what topK/minScore actually rank and filter on, so an old
   * entry that's merely "textually similar" can't outrank a fresher, equally-similar one,
   * and can't survive on similarity alone once it's fully expired (freshness 0 => score 0
   * regardless of how similar the text is). This is the Freshness/TTL handling: decay, not
   * just a hard cutoff, so a slightly-aged entry is worth less rather than invisible. */
  score: number;
  content: string;
  metadata: Record<string, unknown>;
  sourceUrl: string;
  businessId?: string;
}

// How long a memory entry stays retrievable at all before freshness decays it to 0 —
// competitor landscapes, pricing, and positioning genuinely shift over months; six months
// is a reasonable starting horizon for research this codebase doesn't yet have a signal
// to tune from (unlike CompetitorProvider's MEMORY_MIN_SCORE, which real embeddings did
// calibrate — revisit this one similarly once there's real usage data on how stale
// retrieved memory turns out to be in practice).
const DEFAULT_MEMORY_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface ResearchMemoryQuery {
  kind: string;
  embedding: number[];
  topK: number;
  /** Restrict retrieval to one workspace, or omit for cross-workspace retrieval — cross-
   * business industry patterns are exactly what Competitor Intelligence wants to surface. */
  workspaceId?: string;
  /** Excludes memory previously written for this same business — retrieving a business's
   * own prior research about itself isn't cross-business signal, it's an echo. */
  excludeBusinessId?: string;
  /** Drops candidates below this combined (similarity * freshness) score so a topK slice
   * can't be padded out with irrelevant or stale filler when fewer than topK genuinely
   * useful entries exist. */
  minScore?: number;
  /** Overrides DEFAULT_MEMORY_TTL_MS for this query. */
  ttlMs?: number;
}

// Upper bound on rows fetched-then-scored per query — brute-force cosine similarity in JS
// is fine up to a few thousand rows; beyond that this is exactly the "revisit with
// pgvector" signal called out in the schema.prisma doc comment above ResearchMemoryEntry.
const MAX_CANDIDATES = 2000;

/** Reused, not reimplemented — this is the same dot-product-of-unit-vectors formula as
 * infra/vectorStore.ts's cosineSimilarity, duplicated locally rather than shared because
 * that file's version is intentionally paired with its own hashEmbedding placeholder and
 * the two are expected to diverge once one of them moves to a real vector backend. */
export function cosineSimilarity(a: number[], b: number[]): number {
  // Mismatched lengths mean the two vectors came from different embedding models (e.g. a
  // row embedded before a provider switch — a prior 1536-dim model vs. Bedrock Titan
  // Text Embeddings V2 at 1024-dim) — comparing them at all would silently produce a
  // meaningless partial dot product (or NaN, if b is shorter than a), not a real similarity
  // score. Zero is the correct answer: these rows simply predate the current embedding
  // model and can never match a new query, exactly as if they'd aged out.
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Returns the created rows' ids (client-generated before insert, not a round-trip read)
 * — MemoryCoordinator.ts uses these to report which id a write landed at. Existing callers
 * that don't need the ids (they predate MemoryCoordinator) just don't use the return value;
 * this is a backward-compatible, additive signature change (void -> string[]). */
export async function recordMemory(records: ResearchMemoryRecord[]): Promise<string[]> {
  if (records.length === 0) return [];
  const ids = records.map(() => randomUUID());
  await prisma.researchMemoryEntry.createMany({
    data: records.map((r, i) => ({
      id: ids[i],
      workspaceId: r.workspaceId,
      businessId: r.businessId,
      kind: r.kind,
      sourceUrl: r.sourceUrl,
      content: r.content,
      metadata: r.metadata as any,
      embedding: r.embedding,
    })),
  });
  return ids;
}

/** Exact (not similarity-based) lookup by a caller-defined dedup key stored in
 * metadata.dedupKey — MemoryCoordinator.ts's "does an entry for THIS SPECIFIC entity
 * already exist" check, used to update-in-place instead of accumulating duplicate rows
 * for the same competitor/segment/URL every time an Intelligence engine re-runs. */
export async function findMemoryEntryByDedupKey(kind: string, workspaceId: string, dedupKey: string): Promise<{ id: string } | null> {
  return prisma.researchMemoryEntry.findFirst({
    where: { kind, workspaceId, metadata: { path: ["dedupKey"], equals: dedupKey } },
    select: { id: true },
  });
}

/** Same lookup as findMemoryEntryByDedupKey, but returns the stored metadata directly —
 * saves a caller a second round-trip when what it actually wants is "what did we
 * previously record for this entity," not just its id. */
export async function getMemoryEntryMetadata(kind: string, workspaceId: string, dedupKey: string): Promise<Record<string, unknown> | undefined> {
  const row = await prisma.researchMemoryEntry.findFirst({
    where: { kind, workspaceId, metadata: { path: ["dedupKey"], equals: dedupKey } },
    select: { metadata: true },
  });
  return row ? (row.metadata as Record<string, unknown>) : undefined;
}

/** Refreshes an existing entry's content/metadata/embedding AND its createdAt — an update
 * represents "we just re-confirmed this," which should reset the freshness/TTL clock the
 * same way a brand-new entry would start at freshness 1, not leave a stale timestamp on
 * data that was, in fact, just re-verified. */
export async function updateMemoryEntry(id: string, updates: { content: string; metadata: Record<string, unknown>; embedding: number[] }): Promise<void> {
  await prisma.researchMemoryEntry.update({
    where: { id },
    data: { content: updates.content, metadata: updates.metadata as any, embedding: updates.embedding, createdAt: new Date() },
  });
}

export async function queryMemory(query: ResearchMemoryQuery): Promise<ResearchMemoryMatch[]> {
  const rows = await prisma.researchMemoryEntry.findMany({
    where: {
      kind: query.kind,
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.excludeBusinessId ? { businessId: { not: query.excludeBusinessId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_CANDIDATES,
  });

  const minScore = query.minScore ?? 0;
  const ttlMs = query.ttlMs ?? DEFAULT_MEMORY_TTL_MS;
  return rows
    .map((row) => {
      const similarity = cosineSimilarity(query.embedding, row.embedding);
      const freshness = freshnessScore(row.createdAt, ttlMs);
      return {
        id: row.id,
        similarity,
        freshness,
        score: Math.round(similarity * freshness * 10000) / 10000,
        content: row.content,
        metadata: row.metadata as Record<string, unknown>,
        sourceUrl: row.sourceUrl,
        businessId: row.businessId ?? undefined,
      };
    })
    .filter((m) => m.freshness > 0 && m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, query.topK);
}
