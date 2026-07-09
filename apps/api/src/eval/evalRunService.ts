import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import type { EvalRunSummary } from "./types.js";

export interface EvalRunRecord extends EvalRunSummary {
  id: string;
  createdAt: string;
}

function fromRow(row: {
  id: string; suite: string; target: string | null; totalCases: number; passedCases: number;
  avgScore: number; avgConfidence: number | null; cases: unknown; startedAt: Date; completedAt: Date; createdAt: Date;
}): EvalRunRecord {
  return {
    id: row.id,
    suite: row.suite,
    target: row.target ?? undefined,
    totalCases: row.totalCases,
    passedCases: row.passedCases,
    avgScore: row.avgScore,
    avgConfidence: row.avgConfidence ?? undefined,
    cases: row.cases as EvalRunSummary["cases"],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordEvalRun(summary: EvalRunSummary): Promise<EvalRunRecord> {
  const row = await prisma.aiEvaluationRun.create({
    data: {
      id: randomUUID(),
      suite: summary.suite,
      target: summary.target,
      totalCases: summary.totalCases,
      passedCases: summary.passedCases,
      avgScore: summary.avgScore,
      avgConfidence: summary.avgConfidence,
      cases: summary.cases as any,
      startedAt: new Date(summary.startedAt),
      completedAt: new Date(summary.completedAt),
    },
  });
  return fromRow(row);
}

export async function listEvalRuns(suite?: string, limit = 20): Promise<EvalRunRecord[]> {
  const rows = await prisma.aiEvaluationRun.findMany({
    where: suite ? { suite } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(fromRow);
}

export async function getEvalRun(id: string): Promise<EvalRunRecord | null> {
  const row = await prisma.aiEvaluationRun.findUnique({ where: { id } });
  return row ? fromRow(row) : null;
}
