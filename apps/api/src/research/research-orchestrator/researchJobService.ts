import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
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
