import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { findReusableResearch } from "../research/research-orchestrator/researchJobService.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

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
}): Promise<string> {
  const id = randomUUID();
  const completedAt = o.ageMs == null ? null : new Date(Date.now() - o.ageMs);
  await prisma.researchJob.create({
    data: {
      id,
      workspaceId: o.workspaceId,
      businessId: o.businessId,
      url: o.url,
      status: o.status ?? "completed",
      completedAt,
      ...(o.nullContext ? {} : { context: { jobId: id, businessId: o.businessId, url: o.url, marker: id } as any }),
    },
  });
  return id;
}

test("findReusableResearch - returns a completed job within TTL, but not one just past it, nor one that never completed", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://ttl-${randomUUID()}.example.com`;
  try {
    // Completed 30 min ago, TTL 1h → hit.
    const withinId = await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2 });
    const hit = await findReusableResearch(ws, biz, url, HOUR);
    assert.strictEqual(hit?.researchJobId, withinId, "a job completed within the TTL must be returned");

    // Replace it with one completed just past the TTL → miss.
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR + 60_000 });
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR), null, "a job completed just past the TTL must NOT be returned");

    // A row marked completed but with no completedAt (should never happen in practice) is
    // excluded by the gte filter — a partial/aborted run can never be served.
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, status: "completed", ageMs: null });
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR), null, "a completed row with a NULL completedAt must NOT be returned");
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
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR), null, "only status=completed jobs are eligible");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

test("findReusableResearch - a completed job with a NULL context is not returned", async () => {
  const ws = randomUUID(), biz = randomUUID(), url = `https://ctx-${randomUUID()}.example.com`;
  try {
    await seedResearchJob({ workspaceId: ws, businessId: biz, url, ageMs: HOUR / 2, nullContext: true });
    assert.strictEqual(await findReusableResearch(ws, biz, url, HOUR), null, "a completed job without a persisted context can't be reused");
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});

test("findReusableResearch - one business's completed job is never returned for another business (or workspace) query", async () => {
  const ws = randomUUID(), otherWs = randomUUID(), bizA = randomUUID(), bizB = randomUUID();
  const url = `https://xbiz-${randomUUID()}.example.com`;
  try {
    await seedResearchJob({ workspaceId: ws, businessId: bizA, url, ageMs: HOUR / 2 });

    assert.strictEqual(await findReusableResearch(ws, bizB, url, HOUR), null, "a different business must never match, even with the same workspace + url");
    assert.strictEqual(await findReusableResearch(otherWs, bizA, url, HOUR), null, "a different workspace must never match, even with the same business + url");

    // Sanity: the exact (workspace, business, url) DOES hit, proving the row is findable and
    // only the key part being varied is what excludes it above.
    const hit = await findReusableResearch(ws, bizA, url, HOUR);
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
    const hit = await findReusableResearch(ws, biz, url, HOUR);
    assert.strictEqual(hit?.researchJobId, newer, "must return the newest completed research job");
    assert.notStrictEqual(hit?.researchJobId, older);
  } finally {
    await prisma.researchJob.deleteMany({ where: { workspaceId: ws } });
  }
});
