import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../modules/logger/logger.js";
import type { ProviderResult, ResearchContext, ResearchJobStatus } from "../types/index.js";

export interface ResearchJobRecord {
  id: string;
  workspaceId: string;
  businessId?: string;
  url: string;
  status: ResearchJobStatus;
  context: ResearchContext | null;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderExecutionRecord {
  id: string;
  provider: string;
  priority: number;
  status: string;
  attempt: number;
  data: unknown;
  citations: unknown;
  confidence?: number;
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ResearchJobWithExecutions extends ResearchJobRecord {
  executions: ProviderExecutionRecord[];
  evidenceCount: number;
}

function fromRow(row: {
  id: string; workspaceId: string; businessId: string | null; url: string; status: string; context: unknown;
  error: string | null; startedAt: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date;
}): ResearchJobRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    businessId: row.businessId ?? undefined,
    url: row.url,
    status: row.status as ResearchJobStatus,
    context: (row.context as unknown as ResearchContext) ?? null,
    error: row.error ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createResearchJob(workspaceId: string, url: string, businessId?: string): Promise<ResearchJobRecord> {
  const row = await prisma.researchJob.create({
    data: { id: randomUUID(), workspaceId, businessId, url, status: "pending" },
  });
  return fromRow(row);
}

export async function getResearchJob(id: string): Promise<ResearchJobRecord | null> {
  const row = await prisma.researchJob.findUnique({ where: { id } });
  return row ? fromRow(row) : null;
}

/** Richer read for GET /research/:id — includes the per-provider execution trail so the
 * caller can see which of the 9 providers succeeded/failed/retried without a second endpoint. */
export async function getResearchJobWithExecutions(id: string): Promise<ResearchJobWithExecutions | null> {
  const row = await prisma.researchJob.findUnique({
    where: { id },
    include: { executions: { orderBy: { createdAt: "asc" } }, evidence: true },
  });
  if (!row) return null;
  return {
    ...fromRow(row),
    executions: row.executions.map((e) => ({
      id: e.id,
      provider: e.provider,
      priority: e.priority,
      status: e.status,
      attempt: e.attempt,
      data: e.data,
      citations: e.citations,
      confidence: e.confidence ?? undefined,
      error: e.error ?? undefined,
      startedAt: e.startedAt.toISOString(),
      completedAt: e.completedAt?.toISOString(),
      durationMs: e.durationMs ?? undefined,
    })),
    evidenceCount: row.evidence.length,
  };
}

export async function markResearchJobStatus(id: string, status: ResearchJobStatus, extra?: { startedAt?: boolean; completedAt?: boolean; error?: string }): Promise<void> {
  await prisma.researchJob.update({
    where: { id },
    data: {
      status,
      ...(extra?.startedAt ? { startedAt: new Date() } : {}),
      ...(extra?.completedAt ? { completedAt: new Date() } : {}),
      ...(extra?.error !== undefined ? { error: extra.error } : {}),
    },
  });
}

export async function markResearchJobCompleted(id: string, context: ResearchContext): Promise<void> {
  await prisma.researchJob.update({
    where: { id },
    data: { status: "completed", context: context as any, completedAt: new Date() },
  });
}

/** Persists one provider's outcome as its own ProviderExecution row (one row per attempt —
 * a retried provider therefore accumulates multiple rows) plus a ResearchEvidence row per
 * citation it surfaced, called right after each provider settles so a poller watching
 * GET /research/:id sees the execution trail grow in near-real-time, same pattern as
 * ResearchSession's appendResearchBlock. */
export async function recordProviderExecution(jobId: string, result: ProviderResult<unknown>): Promise<void> {
  await prisma.providerExecution.create({
    data: {
      id: randomUUID(),
      researchJobId: jobId,
      provider: result.provider,
      priority: 0,
      status: result.status,
      attempt: result.attempt,
      data: (result.data ?? null) as any,
      citations: result.citations as any,
      confidence: result.confidence,
      error: result.error,
      startedAt: new Date(result.startedAt),
      completedAt: new Date(result.completedAt),
      durationMs: result.durationMs,
    },
  });

  if (result.evidence.length > 0) {
    await prisma.researchEvidence.createMany({
      data: result.evidence.map((e) => ({
        id: randomUUID(),
        researchJobId: jobId,
        provider: result.provider,
        url: e.url,
        title: e.title,
        snippet: e.snippet,
      })),
    });
  }
}

export async function createResearchSnapshot(jobId: string, context: ResearchContext, version = 1): Promise<void> {
  await prisma.researchSnapshot.create({
    data: { id: randomUUID(), researchJobId: jobId, version, context: context as any },
  });
}

/**
 * Cache quality-gate: is a persisted ResearchContext trustworthy enough to REUSE, or was it
 * produced by a degraded run that should be re-researched rather than re-served? Pure logic on
 * the context (no DB, no LLM), so it's deterministically unit-testable. Two independent checks:
 *
 *   - company identity anchor: `context.company == null` means the company provider produced
 *     nothing (e.g. it timed out under a Groq/Ollama storm). This is a HARD invariant, not
 *     tunable — a run with no company identity is exactly what let the market provider
 *     confabulate a wrong industry (the 07-16 `polluxa.com` "medical device" hallucination that
 *     two later cache hits re-served). `== null` catches both null and undefined.
 *   - grounding confidence: `context.metadata.overallConfidence` (0-1, failed providers count
 *     as 0) below `minConfidence` means too little of the research was really grounded. The
 *     poisoned run scored 0.34; a healthy run where most providers succeed sits well above the
 *     0.50 default. Boundary is inclusive: exactly `minConfidence` passes, just-below fails.
 *
 * Returns true only if BOTH pass. Kept separate from the DB lookup so both the predicate and its
 * wiring into findReusableResearch can be tested independently.
 */
export function isReusableContext(context: ResearchContext, minConfidence: number): boolean {
  if (context.company == null) return false;
  const overallConfidence = context.metadata?.overallConfidence ?? 0;
  return overallConfidence >= minConfidence;
}

/**
 * A recently-completed research job for this exact (workspace, business, url) whose full
 * persisted ResearchContext can be reused instead of re-running Phase 1's 27-provider fan-out.
 * Only status "completed" jobs with a non-null context inside `ttlMs` are eligible; newest
 * first. Keyed on businessId (not url alone) so one business can never match another's row —
 * the caller still does a defense-in-depth identity re-check on the returned context (see
 * campaignGenerationPipeline); this only performs the keyed lookup.
 *
 * `minConfidence` is passed in (like `ttlMs`), not read from env here, so env parsing stays in
 * the pipeline. A row that matches the key but fails the quality-gate (isReusableContext) is
 * treated as a cache MISS — the caller then runs fresh research rather than re-serving degraded
 * output. This is the READ-side gate; a WRITE-side `cacheable` flag is a deferred follow-up
 * (see PROJECT_STATUS §4/§5) since it would need a schema migration.
 */
export async function findReusableResearch(
  workspaceId: string,
  businessId: string,
  url: string,
  ttlMs: number,
  minConfidence: number
): Promise<{ researchJobId: string; context: ResearchContext } | null> {
  const row = await prisma.researchJob.findFirst({
    where: {
      workspaceId,
      businessId,
      url,
      status: "completed",
      // completedAt is null until markResearchJobCompleted runs, so this gte also excludes
      // any job that never actually finished — a partial/aborted run can never be served.
      completedAt: { gte: new Date(Date.now() - ttlMs) },
    },
    orderBy: { completedAt: "desc" },
  });
  if (!row || row.context == null) return null;

  const context = row.context as unknown as ResearchContext;
  if (!isReusableContext(context, minConfidence)) {
    // Tripwire, mirroring the pipeline's identity-mismatch warning: a keyed row exists but is
    // too degraded to reuse, so we're deliberately taking a cache miss and re-researching.
    logger.warn(
      `Research cache candidate ${row.id} rejected by quality-gate (company=${context.company == null ? "null" : "present"}, ` +
        `overallConfidence=${context.metadata?.overallConfidence ?? 0}, minConfidence=${minConfidence}) — running fresh research`
    );
    return null;
  }
  return { researchJobId: row.id, context };
}
