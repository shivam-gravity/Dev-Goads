import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { findReusableResearch, isReusableContext } from "../research/research-orchestrator/researchJobService.js";
import type { ResearchContext } from "../research/types/index.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

const DEFAULT_MIN_CONFIDENCE = 0.5;

// Minimal ResearchContext for the quality-gate predicate — only the two fields it reads
// (company, metadata.overallConfidence) matter; the rest is cast-filled so tests stay focused.
function ctx(o: { company?: unknown; overallConfidence?: number }): ResearchContext {
  return {
    company: o.company === undefined ? { name: "Acme", summary: "s", dataSource: "d" } : o.company,
    metadata: { overallConfidence: o.overallConfidence ?? 0.9 },
  } as unknown as ResearchContext;
}

// DB-backed coverage of findReusableResearch's actual SQL WHERE clause — the cache-key
// correctness the pipeline unit tests (which inject a fake) can't reach. ResearchJob has no
// FK to workspace/business (plain indexed string columns), so rows are seeded directly with
// arbitrary ids and an explicit completedAt/status/context. Every test uses a fresh
// workspaceId and cleans up by it, so runs never interfere with each other or real data.
const HOUR = 60 * 60 * 1000;

async function seedResearchJob(o: {
  workspaceId: string;
  businessId: string;
  url: string;
  status?: string;
  /** How long ago the job "completed", in ms. null → completedAt stays NULL (never finished). */
  ageMs?: number | null;
  /** Omit the context column entirely (defaults to NULL), like createResearchJob does. */
  nullContext?: boolean;
  /** Force context.company to null (degraded — company provider produced nothing). */
  nullCompany?: boolean;
  /** Override context.metadata.overallConfidence (defaults to a healthy 0.9). */
  overallConfidence?: number;
}): Promise<string> {
  const id = randomUUID();
  const completedAt = o.ageMs == null ? null : new Date(Date.now() - o.ageMs);
  const context = {
    jobId: id,
    businessId: o.businessId,
    url: o.url,
    marker: id,
    company: o.nullCompany ? null : { name: "Acme", summary: "s", dataSource: "d" },
    metadata: { overallConfidence: o.overallConfidence ?? 0.9 },
  };
  await prisma.researchJob.create({
    data: {
      id,
      workspaceId: o.workspaceId,
      businessId: o.businessId,
      url: o.url,
      status: o.status ?? "completed",
      completedAt,
      ...(o.nullContext ? {} : { context: context as any }),
    },
  });
  return id;
}

test("findReusableResearch - returns a completed job within TTL, but not one just past it, nor one that never completed", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://ttl-${randomUUID()}.example.com`;
  try {
    // Completed 30 min ago, TTL 1h → hit.
    const withinId = await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2 });
    const hit = await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE);
    assert.strictEqual(hit?.researchJobId, withinId, "a job completed within the TTL must be returned");

    // Replace it with one completed just past the TTL → miss.
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR + 60_000 });
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE), null, "a job completed just past the TTL must NOT be returned");

    // A row marked completed but with no completedAt (should never happen in practice) is
    // excluded by the gte filter — a partial/aborted run can never be served.
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, status: "completed", ageMs: null });
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE), null, "a completed row with a NULL completedAt must NOT be returned");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

test("findReusableResearch - never returns a non-completed job (running/failed/pending/aggregating)", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://status-${randomUUID()}.example.com`;
  try {
    for (const status of ["running", "failed", "pending", "aggregating"]) {
      await seedResearchJob({ workspaceId: ws, businessId: biz, url, status, ageMs: null });
    }
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE), null, "only status=completed jobs are eligible");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

test("findReusableResearch - a completed job with a NULL context is not returned", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://ctx-${randomUUID()}.example.com`;
  try {
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2, nullContext: true });
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE), null, "a completed job without a persisted context can't be reused");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

test("findReusableResearch - one business's completed job is never returned for another business (or workspace) query", async () => {
  const ws = randomUUID(), otherWs = randomUUID(), bizA = randomUUID(), bizB = randomUUID();
  const url = `https://xbiz-${randomUUID()}.example.com`;
  try {
    await seedResearchJob({ workspaceId: ws, businessId: bizA, url, ageMs: HOUR / 2 });

    assert.strictEqual(await findReusableResearch(ws, bizB, url, HOUR, DEFAULT_MIN_CONFIDENCE), null, "a different business must never match, even with the same workspace + url");
    assert.strictEqual(await findReusableResearch(otherWs, bizA, url, HOUR, DEFAULT_MIN_CONFIDENCE), null, "a different workspace must never match, even with the same business + url");

    // Sanity: the exact (workspace, business, url) DOES hit, proving the row is findable and
    // only the key part being varied is what excludes it above.
    const hit = await findReusableResearch(ws, bizA, url, HOUR, DEFAULT_MIN_CONFIDENCE);
    assert.strictEqual(hit?.context.businessId, bizA, "the exact key must return the seeded row");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
    await prisma.researchJob.deleteMany({ where: { workspaceId: otherWs } });
  }
});

test("findReusableResearch - returns the most-recently-completed row when several are valid", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://order-${randomUUID()}.example.com`;
  try {
    const older = await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2 }); // 30m ago
    const newer = await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: 60_000 });   // 1m ago
    const hit = await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE);
    assert.strictEqual(hit?.researchJobId, newer, "must return the newest completed research job");
    assert.notStrictEqual(hit?.researchJobId, older);
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

// ── Quality-gate predicate (isReusableContext) — pure logic, no DB, no Groq ──

test("isReusableContext - rejects a null company identity anchor even at high confidence", () => {
  // The hard invariant: no company identity → reject regardless of how high overallConfidence is
  // (this is exactly the 07-16 degraded run's shape — the market provider confabulated an
  // industry precisely because the company anchor was missing).
  assert.strictEqual(isReusableContext(ctx({ company: null, overallConfidence: 0.99 }), DEFAULT_MIN_CONFIDENCE), false);
  // undefined company (field never populated) is caught by the same `== null` check.
  assert.strictEqual(isReusableContext({ metadata: { overallConfidence: 1 } } as any, DEFAULT_MIN_CONFIDENCE), false);
});

test("isReusableContext - rejects a low-confidence context even with a present company", () => {
  // The poisoned run scored 0.34 with a company present-or-not; below-threshold must reject.
  assert.strictEqual(isReusableContext(ctx({ overallConfidence: 0.34 }), DEFAULT_MIN_CONFIDENCE), false);
  assert.strictEqual(isReusableContext(ctx({ overallConfidence: 0 }), DEFAULT_MIN_CONFIDENCE), false);
  // Missing metadata.overallConfidence is treated as 0 → reject.
  assert.strictEqual(isReusableContext({ company: { name: "Acme" }, metadata: {} } as any, DEFAULT_MIN_CONFIDENCE), false);
});

test("isReusableContext - passes a healthy context (company present AND confidence >= threshold)", () => {
  assert.strictEqual(isReusableContext(ctx({ overallConfidence: 0.8 }), DEFAULT_MIN_CONFIDENCE), true);
});

test("isReusableContext - threshold boundary is inclusive: exactly minConfidence passes, just-below fails", () => {
  assert.strictEqual(isReusableContext(ctx({ overallConfidence: 0.5 }), 0.5), true, "exactly at threshold passes");
  assert.strictEqual(isReusableContext(ctx({ overallConfidence: 0.4999 }), 0.5), false, "just below fails");
});

test("isReusableContext - the threshold is honored as passed (param-driven, not hardcoded)", () => {
  // Same context, different thresholds → different verdicts, proving the caller's minConfidence
  // is what's applied (the pipeline passes env-derived CAMPAIGN_RESEARCH_MIN_CONFIDENCE).
  const c = ctx({ overallConfidence: 0.6 });
  assert.strictEqual(isReusableContext(c, 0.5), true, "0.6 >= 0.5 → pass");
  assert.strictEqual(isReusableContext(c, 0.7), false, "0.6 < 0.7 → reject under a stricter threshold");
});

// ── DB-backed wiring: findReusableResearch applies the gate on the fetched row ──

test("findReusableResearch - a keyed, in-TTL, completed row with a NULL company is a cache miss (gate)", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://gate-company-${randomUUID()}.example.com`;
  try {
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2, nullCompany: true, overallConfidence: 0.99 });
    assert.strictEqual(
      await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE),
      null,
      "a row that matches the key but has a null company identity must be a cache miss, even at high confidence"
    );
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

test("findReusableResearch - a keyed, in-TTL, completed row below the confidence threshold is a cache miss (gate)", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://gate-conf-${randomUUID()}.example.com`;
  try {
    // Mirrors the 07-16 poisoned run: company present but overallConfidence 0.34.
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2, overallConfidence: 0.34 });
    assert.strictEqual(
      await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE),
      null,
      "a degraded (low-confidence) row must be a cache miss so the caller re-researches"
    );
    // Sanity: the SAME row passes under a threshold it clears, proving only the gate excluded it.
    const hit = await findReusableResearch(ws, biz, url, HOUR, 0.3);
    assert.strictEqual(hit?.context.metadata?.overallConfidence, 0.34, "clearing the threshold makes the same row a hit");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

test("findReusableResearch - a healthy keyed row still hits with the gate in place (no over-rejection)", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://gate-ok-${randomUUID()}.example.com`;
  try {
    const id = await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2, overallConfidence: 0.8 });
    const hit = await findReusableResearch(ws, biz, url, HOUR, DEFAULT_MIN_CONFIDENCE);
    assert.strictEqual(hit?.researchJobId, id, "a healthy, well-grounded, identity-anchored row is still served");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});
