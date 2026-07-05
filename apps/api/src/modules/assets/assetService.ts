import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";

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

function save(a: Asset) {
  db.prepare("INSERT OR REPLACE INTO assets (id, workspaceId, data, createdAt) VALUES (?, ?, ?, ?)").run(a.id, a.workspaceId, JSON.stringify(a), a.createdAt);
}

export function seedDemoAssets(workspaceId: string) {
  const existing = listAssets(workspaceId);
  if (existing.length > 0) return;
  for (const d of DEMO_ASSETS) {
    const a: Asset = { id: randomUUID(), workspaceId, createdAt: new Date().toISOString(), ...d };
    save(a);
  }
}

export function listAssets(workspaceId: string, type?: Asset["type"]): Asset[] {
  const rows = db.prepare("SELECT data FROM assets WHERE workspaceId = ? ORDER BY createdAt DESC").all(workspaceId) as { data: string }[];
  const all = rows.map((r) => JSON.parse(r.data) as Asset);
  return type ? all.filter((a) => a.type === type) : all;
}

export function createAsset(workspaceId: string, input: Omit<Asset, "id" | "workspaceId" | "createdAt" | "usageCount">): Asset {
  const a: Asset = { id: randomUUID(), workspaceId, usageCount: 0, createdAt: new Date().toISOString(), ...input };
  save(a);
  return a;
}

export function deleteAsset(id: string): boolean {
  const r = db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  return r.changes > 0;
}

export function updateAssetTags(id: string, tags: string[]): Asset {
  const row = db.prepare("SELECT data FROM assets WHERE id = ?").get(id) as { data: string } | undefined;
  if (!row) throw new Error("Asset not found");
  const a: Asset = { ...JSON.parse(row.data), tags };
  save(a);
  return a;
}
