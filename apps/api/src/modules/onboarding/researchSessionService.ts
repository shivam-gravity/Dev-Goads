import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import type { AudiencePersona, CampaignSuggestion, DeepResearchBlock } from "../../types/index.js";

export type ResearchSessionStatus = "queued" | "running" | "done" | "failed";

// A completed session for the same URL within this window is reused instead of paying
// for fresh real web searches — the DB-level counterpart to marketResearch.ts's
// in-process prompt cache, one layer up (whole-session, not per-prompt).
const SESSION_CACHE_WINDOW_MS = 60 * 60 * 1000;

// A single runaway block can't blow the search budget — once a session hits this many
// real web_search invocations across all its blocks, remaining blocks fall back to the
// no-search reasoning path automatically (see runFullDeepResearch in marketResearch.ts).
export const MAX_SEARCHES_PER_SESSION = 16;

export interface ResearchSession {
  id: string;
  workspaceId: string;
  businessId?: string;
  url: string;
  status: ResearchSessionStatus;
  currentStep?: string;
  blocks: DeepResearchBlock[];
  personas?: AudiencePersona[];
  campaignSuggestions?: CampaignSuggestion[];
  result?: unknown;
  error?: string;
  searchCount: number;
  cacheHit: boolean;
  createdAt: string;
  updatedAt: string;
}

function fromRow(row: {
  id: string; workspaceId: string; businessId: string | null; url: string; status: string; currentStep: string | null;
  blocks: unknown; personas: unknown; campaignSuggestions: unknown; result: unknown; error: string | null; searchCount: number; cacheHit: boolean;
  createdAt: Date; updatedAt: Date;
}): ResearchSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    businessId: row.businessId ?? undefined,
    url: row.url,
    status: row.status as ResearchSessionStatus,
    currentStep: row.currentStep ?? undefined,
    blocks: (row.blocks as unknown as DeepResearchBlock[]) ?? [],
    personas: (row.personas as unknown as AudiencePersona[]) ?? undefined,
    campaignSuggestions: (row.campaignSuggestions as unknown as CampaignSuggestion[]) ?? undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    searchCount: row.searchCount,
    cacheHit: row.cacheHit,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A recently-completed session for this exact URL, if one exists — the caller decides whether to clone it instead of enqueueing fresh work. */
export async function findCachedSession(workspaceId: string, url: string): Promise<ResearchSession | null> {
  const row = await prisma.researchSession.findFirst({
    where: { workspaceId, url, status: "done", updatedAt: { gte: new Date(Date.now() - SESSION_CACHE_WINDOW_MS) } },
    orderBy: { updatedAt: "desc" },
  });
  return row ? fromRow(row) : null;
}

export async function createResearchSession(workspaceId: string, url: string, businessId?: string): Promise<ResearchSession> {
  const row = await prisma.researchSession.create({
    data: { id: randomUUID(), workspaceId, businessId, url, status: "queued" },
  });
  return fromRow(row);
}

/** Clones a cached session's result into a new row so the caller always gets back a fresh session id, with cacheHit=true and zero new search spend. */
export async function cloneSessionFromCache(workspaceId: string, url: string, source: ResearchSession, businessId?: string): Promise<ResearchSession> {
  const row = await prisma.researchSession.create({
    data: {
      id: randomUUID(),
      workspaceId,
      businessId,
      url,
      status: "done",
      currentStep: source.currentStep,
      blocks: source.blocks as any,
      personas: (source.personas ?? null) as any,
      campaignSuggestions: (source.campaignSuggestions ?? null) as any,
      result: (source.result ?? null) as any,
      searchCount: 0,
      cacheHit: true,
    },
  });
  return fromRow(row);
}

export async function getResearchSession(id: string): Promise<ResearchSession | null> {
  const row = await prisma.researchSession.findUnique({ where: { id } });
  return row ? fromRow(row) : null;
}

export async function markResearchSessionRunning(id: string): Promise<void> {
  await prisma.researchSession.update({ where: { id }, data: { status: "running" } });
}

/** Marks which step is actively in progress (called right before a block starts, not after) — appendResearchBlock below overwrites this with the same label once that block finishes, so pollers always see either "in progress: X" or "last completed: X", never a stale in-between value. */
export async function setResearchSessionCurrentStep(id: string, label: string): Promise<void> {
  await prisma.researchSession.update({ where: { id }, data: { currentStep: label } });
}

/** Appends one completed block and bumps the running search-cost counter — called after each research block finishes so pollers see the transcript grow. */
export async function appendResearchBlock(id: string, block: DeepResearchBlock, searchesUsed: number): Promise<ResearchSession> {
  const current = await prisma.researchSession.findUnique({ where: { id } });
  if (!current) throw new Error("Research session not found");
  const blocks = [...((current.blocks as unknown as DeepResearchBlock[]) ?? []), block];
  const row = await prisma.researchSession.update({
    where: { id },
    data: { blocks: blocks as any, currentStep: block.label, searchCount: current.searchCount + searchesUsed },
  });
  return fromRow(row);
}

export async function setResearchSessionPersonas(id: string, personas: AudiencePersona[]): Promise<void> {
  await prisma.researchSession.update({ where: { id }, data: { personas: personas as any } });
}

/** Persists the 6+ generated campaign suggestions once, right after research completes — the
 * /research-sessions/:id/campaign-suggestions route checks this before calling
 * generateCampaignSuggestions again, so re-visiting the page never regenerates them. */
export async function setResearchSessionCampaignSuggestions(id: string, suggestions: CampaignSuggestion[]): Promise<ResearchSession> {
  const row = await prisma.researchSession.update({ where: { id }, data: { campaignSuggestions: suggestions as any } });
  return fromRow(row);
}

export async function markResearchSessionDone(id: string, result: unknown): Promise<void> {
  await prisma.researchSession.update({ where: { id }, data: { status: "done", result: result as any } });
}

export async function markResearchSessionFailed(id: string, error: string): Promise<void> {
  await prisma.researchSession.update({ where: { id }, data: { status: "failed", error } });
}
