import { test } from "node:test";
import assert from "node:assert";
import { cosineSimilarity, queryMemory, recordMemory } from "../research/memory/ResearchMemoryStore.js";
import { prisma } from "../db/prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("cosineSimilarity - identical vectors score 1", () => {
  assert.strictEqual(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
});

test("cosineSimilarity - orthogonal vectors score 0", () => {
  assert.strictEqual(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
});

test("cosineSimilarity - opposite vectors score -1", () => {
  assert.strictEqual(cosineSimilarity([1, 0, 0], [-1, 0, 0]), -1);
});

test("cosineSimilarity - a zero vector never divides by zero", () => {
  assert.strictEqual(cosineSimilarity([0, 0, 0], [1, 0, 0]), 0);
});

test("ResearchMemoryStore - queryMemory ranks by similarity, filters by kind/workspace/minScore, and excludes a business's own memory", async () => {
  const ws = `ws-memtest-${Date.now()}`;
  const otherWs = `${ws}-other`;

  await recordMemory([
    { workspaceId: ws, businessId: "biz-A", kind: "competitor", sourceUrl: "https://a.example.com", content: "Business A", metadata: {}, embedding: [1, 0, 0] },
    { workspaceId: ws, businessId: "biz-B", kind: "competitor", sourceUrl: "https://b.example.com", content: "Business B", metadata: {}, embedding: [0.9, Math.sqrt(1 - 0.81), 0] },
    { workspaceId: ws, businessId: "biz-C", kind: "competitor", sourceUrl: "https://c.example.com", content: "Business C (orthogonal)", metadata: {}, embedding: [0, 1, 0] },
    { workspaceId: otherWs, businessId: "biz-D", kind: "competitor", sourceUrl: "https://d.example.com", content: "Business D (other workspace)", metadata: {}, embedding: [1, 0, 0] },
    { workspaceId: ws, businessId: "biz-E", kind: "other-kind", sourceUrl: "https://e.example.com", content: "Business E (other kind)", metadata: {}, embedding: [1, 0, 0] },
  ]);

  const matches = await queryMemory({ kind: "competitor", embedding: [1, 0, 0], workspaceId: ws, topK: 5, minScore: 0.5 });

  assert.deepStrictEqual(matches.map((m) => m.businessId), ["biz-A", "biz-B"], "orthogonal Business C should be filtered out by minScore, and other workspace/kind excluded by their filters");
  assert.ok(matches[0].score >= matches[1].score, "results must be sorted by descending similarity");
  assert.strictEqual(matches[0].businessId, "biz-A", "the exact match should rank first");

  const excluded = await queryMemory({ kind: "competitor", embedding: [1, 0, 0], workspaceId: ws, topK: 5, minScore: 0.5, excludeBusinessId: "biz-A" });
  assert.deepStrictEqual(excluded.map((m) => m.businessId), ["biz-B"], "excludeBusinessId should drop that business's own memory");

  const topOne = await queryMemory({ kind: "competitor", embedding: [1, 0, 0], workspaceId: ws, topK: 1, minScore: 0 });
  assert.strictEqual(topOne.length, 1);
  assert.strictEqual(topOne[0].businessId, "biz-A");
});

test("ResearchMemoryStore - recordMemory is a no-op for an empty array (no error, no rows written)", async () => {
  await assert.doesNotReject(() => recordMemory([]));
});

test("ResearchMemoryStore - freshness decays an older entry's combined score and can exclude it via minScore", async () => {
  const ws = `ws-freshtest-${Date.now()}`;
  const ttlMs = 10 * DAY_MS;

  await recordMemory([
    { workspaceId: ws, businessId: "biz-fresh", kind: "competitor", sourceUrl: "https://fresh.example.com", content: "Fresh entry", metadata: {}, embedding: [1, 0, 0] },
    { workspaceId: ws, businessId: "biz-stale", kind: "competitor", sourceUrl: "https://stale.example.com", content: "Stale entry", metadata: {}, embedding: [1, 0, 0] },
  ]);

  // Backdate the "stale" entry's createdAt past the TTL — recordMemory always writes
  // now(), so this simulates an entry written long ago without waiting real time.
  await prisma.researchMemoryEntry.updateMany({
    where: { workspaceId: ws, businessId: "biz-stale" },
    data: { createdAt: new Date(Date.now() - 20 * DAY_MS) },
  });

  const matches = await queryMemory({ kind: "competitor", embedding: [1, 0, 0], workspaceId: ws, topK: 5, minScore: 0, ttlMs });

  assert.deepStrictEqual(matches.map((m) => m.businessId), ["biz-fresh"], "an entry past its TTL should be excluded entirely, even with minScore 0 and identical similarity");
  assert.strictEqual(matches[0].freshness, 1);
  assert.strictEqual(matches[0].similarity, 1);
  assert.strictEqual(matches[0].score, 1);
});

test("ResearchMemoryStore - a partially-aged entry is decayed (not excluded) and ranks below an equally-similar fresh one", async () => {
  const ws = `ws-freshtest2-${Date.now()}`;
  const ttlMs = 10 * DAY_MS;

  await recordMemory([
    { workspaceId: ws, businessId: "biz-fresh", kind: "competitor", sourceUrl: "https://fresh.example.com", content: "Fresh entry", metadata: {}, embedding: [1, 0, 0] },
    { workspaceId: ws, businessId: "biz-halfway", kind: "competitor", sourceUrl: "https://halfway.example.com", content: "Halfway-aged entry", metadata: {}, embedding: [1, 0, 0] },
  ]);

  await prisma.researchMemoryEntry.updateMany({
    where: { workspaceId: ws, businessId: "biz-halfway" },
    data: { createdAt: new Date(Date.now() - 5 * DAY_MS) },
  });

  const matches = await queryMemory({ kind: "competitor", embedding: [1, 0, 0], workspaceId: ws, topK: 5, minScore: 0, ttlMs });

  assert.deepStrictEqual(matches.map((m) => m.businessId), ["biz-fresh", "biz-halfway"], "the fresher entry should outrank the equally-similar, half-decayed one");
  const halfway = matches.find((m) => m.businessId === "biz-halfway")!;
  assert.strictEqual(halfway.freshness, 0.5);
  assert.strictEqual(halfway.score, 0.5, "score = similarity(1) * freshness(0.5)");
});
