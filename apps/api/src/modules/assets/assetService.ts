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

const DEMO_ASSETS: Omit<Asset, "id" | "workspaceId" | "createdAt">[] = [
  { name: "Hero Banner 1200x628", type: "image", url: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1200&q=80", thumbnailUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&q=60", size: 245000, mimeType: "image/jpeg", tags: ["hero", "banner"], usageCount: 3, width: 1200, height: 628 },
  { name: "Product Shot Square", type: "image", url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1080&q=80", thumbnailUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=60", size: 189000, mimeType: "image/jpeg", tags: ["product", "square"], usageCount: 7, width: 1080, height: 1080 },
  { name: "Story Template 9x16", type: "image", url: "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1080&q=80", thumbnailUrl: "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&q=60", size: 312000, mimeType: "image/jpeg", tags: ["story", "vertical"], usageCount: 2, width: 1080, height: 1920 },
  { name: "Team Photo Wide", type: "image", url: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=80", thumbnailUrl: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&q=60", size: 421000, mimeType: "image/jpeg", tags: ["team", "brand"], usageCount: 1, width: 1200, height: 675 },
  { name: "Brand Logo", type: "logo", url: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&q=80", thumbnailUrl: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=200&q=60", size: 42000, mimeType: "image/png", tags: ["brand", "logo"], usageCount: 12, width: 400, height: 400 },
  { name: "Lifestyle Shot", type: "image", url: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80", thumbnailUrl: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=400&q=60", size: 367000, mimeType: "image/jpeg", tags: ["lifestyle", "people"], usageCount: 5, width: 1200, height: 800 },
];

async function save(a: Asset): Promise<void> {
  await prisma.asset.upsert({
    where: { id: a.id },
    create: { id: a.id, workspaceId: a.workspaceId, data: a as any, createdAt: new Date(a.createdAt) },
    update: { data: a as any },
  });
}

export async function seedDemoAssets(workspaceId: string): Promise<void> {
  const existing = await listAssets(workspaceId);
  if (existing.length > 0) return;
  for (const d of DEMO_ASSETS) {
    const a: Asset = { id: randomUUID(), workspaceId, createdAt: new Date().toISOString(), ...d };
    await save(a);
  }
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
