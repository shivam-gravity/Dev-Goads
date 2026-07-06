import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export type GenerationJobType = "image" | "video" | "full_creative";
export type GenerationJobStatus = "queued" | "running" | "done" | "failed";

export interface GenerationJobInput {
  businessId: string;
  productUrl?: string;
  prompt?: string;
  wantVideo: boolean;
}

export interface GenerationJobResult {
  headline: string;
  body: string;
  callToAction: string;
  creativeId: string;
  imageAssetId: string;
  imageUrl: string;
  videoAssetId?: string;
  videoUrl?: string;
}

export interface GenerationJob {
  id: string;
  workspaceId: string;
  businessId: string;
  type: GenerationJobType;
  status: GenerationJobStatus;
  input: GenerationJobInput;
  result?: GenerationJobResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

function fromRow(row: { id: string; workspaceId: string; businessId: string; type: string; status: string; input: unknown; result: unknown; error: string | null; createdAt: Date; updatedAt: Date }): GenerationJob {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    businessId: row.businessId,
    type: row.type as GenerationJobType,
    status: row.status as GenerationJobStatus,
    input: row.input as unknown as GenerationJobInput,
    result: (row.result as unknown as GenerationJobResult) ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createGenerationJob(workspaceId: string, input: GenerationJobInput): Promise<GenerationJob> {
  const row = await prisma.generationJob.create({
    data: {
      id: randomUUID(),
      workspaceId,
      businessId: input.businessId,
      type: input.wantVideo ? "full_creative" : "image",
      status: "queued",
      input: input as any,
    },
  });
  return fromRow(row);
}

export async function getGenerationJob(id: string): Promise<GenerationJob | null> {
  const row = await prisma.generationJob.findUnique({ where: { id } });
  return row ? fromRow(row) : null;
}

export async function markGenerationJobRunning(id: string): Promise<void> {
  await prisma.generationJob.update({ where: { id }, data: { status: "running" } });
}

export async function markGenerationJobDone(id: string, result: GenerationJobResult): Promise<void> {
  await prisma.generationJob.update({ where: { id }, data: { status: "done", result: result as any } });
}

export async function markGenerationJobFailed(id: string, error: string): Promise<void> {
  await prisma.generationJob.update({ where: { id }, data: { status: "failed", error } });
}
