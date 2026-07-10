import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert";
import { findExistingByDedupKey, getMetadataByDedupKey, readMemory, writeMemory } from "../research/memory/MemoryCoordinator.js";

test("writeMemory - creates a new entry the first time, then updates (deduped) on a repeat write for the same dedupKey", async () => {
  const workspaceId = `ws-memcoord-${Date.now()}`;

  const first = await writeMemory({
    workspaceId, kind: "audience-profile", sourceUrl: "https://example.com", dedupKey: "acme-corp",
    content: "Acme Corp targets SMBs.", metadata: { icp: "SMBs" },
  });
  assert.strictEqual(first.deduped, false);

  const second = await writeMemory({
    workspaceId, kind: "audience-profile", sourceUrl: "https://example.com", dedupKey: "acme-corp",
    content: "Acme Corp targets mid-market.", metadata: { icp: "Mid-market" },
  });
  assert.strictEqual(second.deduped, true);
  assert.strictEqual(second.id, first.id, "a repeat write for the same dedupKey must update the SAME row, not create a new one");

  const metadata = await getMetadataByDedupKey("audience-profile", workspaceId, "acme-corp");
  assert.strictEqual(metadata?.icp, "Mid-market", "the update must have overwritten the old metadata");
});

test("writeMemory - different dedupKeys under the same kind/workspace create separate entries", async () => {
  const workspaceId = `ws-memcoord-${Date.now()}`;

  const a = await writeMemory({ workspaceId, kind: "market-profile", sourceUrl: "https://a.com", dedupKey: "biz-a", content: "Market for A", metadata: {} });
  const b = await writeMemory({ workspaceId, kind: "market-profile", sourceUrl: "https://b.com", dedupKey: "biz-b", content: "Market for B", metadata: {} });

  assert.notStrictEqual(a.id, b.id);
});

test("findExistingByDedupKey / getMetadataByDedupKey - return nothing for a dedupKey that was never written", async () => {
  const workspaceId = `ws-memcoord-${Date.now()}`;
  assert.strictEqual(await findExistingByDedupKey("pricing-analysis", workspaceId, "nonexistent"), null);
  assert.strictEqual(await getMetadataByDedupKey("pricing-analysis", workspaceId, "nonexistent"), undefined);
});

test("writeMemory - stores dedupKey inside metadata alongside caller-provided fields", async () => {
  const workspaceId = `ws-memcoord-${Date.now()}`;
  await writeMemory({ workspaceId, kind: "creative-analysis", sourceUrl: "https://example.com", dedupKey: "acme", content: "text", metadata: { tone: "playful" } });

  const metadata = await getMetadataByDedupKey("creative-analysis", workspaceId, "acme");
  assert.strictEqual(metadata?.tone, "playful");
  assert.strictEqual(metadata?.dedupKey, "acme");
});

test("readMemory - applies a per-kind default TTL so a query still returns fresh, unrelated-kind default doesn't leak in", async () => {
  const workspaceId = `ws-memcoord-${Date.now()}`;
  await writeMemory({ workspaceId, kind: "pricing-analysis", sourceUrl: "https://example.com", dedupKey: "acme", content: "Acme pricing starts at $50/mo", metadata: { startingPriceUsd: 50 } });

  const matches = await readMemory({ kind: "pricing-analysis", queryText: "Acme pricing", workspaceId, topK: 5, minScore: 0 });
  assert.ok(matches.length >= 1);
  assert.strictEqual(matches[0].freshness, 1, "a just-written entry must be fully fresh under its kind's default TTL");
});
