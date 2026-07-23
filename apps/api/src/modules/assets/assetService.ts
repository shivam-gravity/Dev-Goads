import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export interface Asset {
  id: string;
  workspaceId: string;
  name: string;
  type: "image" | "video" | "logo" | "font" | "template";
  url: string;
  thumbnailUrl?: string;
  size: number;
  mimeType: string;
  tags: string[];
  usageCount: number;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
}

async function save(a: Asset): Promise<void> {
  await prisma.asset.upsert({
    where: { id: a.id },
    create: { id: a.id, workspaceId: a.workspaceId, data: a as any, createdAt: new Date(a.createdAt) },
    update: { data: a as any },
  });
}

export async function listAssets(workspaceId: string, type?: Asset["type"]): Promise<Asset[]> {
  const rows = await prisma.asset.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  const all = rows.map((r) => r.data as unknown as Asset);
  return type ? all.filter((a) => a.type === type) : all;
}

export async function createAsset(workspaceId: string, input: Omit<Asset, "id" | "workspaceId" | "createdAt" | "usageCount">): Promise<Asset> {
  const a: Asset = { id: randomUUID(), workspaceId, usageCount: 0, createdAt: new Date().toISOString(), ...input };
  await save(a);
  return a;
}

export async function deleteAsset(id: string): Promise<boolean> {
  const r = await prisma.asset.deleteMany({ where: { id } });
  return r.count > 0;
}

export async function updateAssetTags(id: string, tags: string[]): Promise<Asset> {
  const row = await prisma.asset.findUnique({ where: { id } });
  if (!row) throw new Error("Asset not found");
  const a: Asset = { ...(row.data as unknown as Asset), tags };
  await save(a);
  return a;
}
