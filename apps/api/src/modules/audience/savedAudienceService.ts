import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export interface SavedAudience {
  id: string;
  workspaceId: string;
  name: string;
  ageMin: number;
  ageMax: number;
  gender: "all" | "male" | "female";
  locations: string[];
  interests: string[];
  exclusions: string[];
  estimatedReach?: string;
  createdAt: string;
}

async function save(a: SavedAudience): Promise<void> {
  await prisma.savedAudience.upsert({
    where: { id: a.id },
    create: { id: a.id, workspaceId: a.workspaceId, data: a as any, createdAt: new Date(a.createdAt) },
    update: { data: a as any },
  });
}

export async function listSavedAudiences(workspaceId: string): Promise<SavedAudience[]> {
  const rows = await prisma.savedAudience.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as SavedAudience);
}

export async function getSavedAudience(id: string): Promise<SavedAudience | null> {
  const row = await prisma.savedAudience.findUnique({ where: { id } });
  return row ? (row.data as unknown as SavedAudience) : null;
}

export async function createSavedAudience(
  workspaceId: string,
  input: Omit<SavedAudience, "id" | "workspaceId" | "createdAt">
): Promise<SavedAudience> {
  const a: SavedAudience = { id: randomUUID(), workspaceId, createdAt: new Date().toISOString(), ...input };
  await save(a);
  return a;
}

export async function updateSavedAudience(id: string, patch: Partial<Omit<SavedAudience, "id" | "workspaceId" | "createdAt">>): Promise<SavedAudience> {
  const row = await prisma.savedAudience.findUnique({ where: { id } });
  if (!row) throw new Error("Saved audience not found");
  const a: SavedAudience = { ...(row.data as unknown as SavedAudience), ...patch };
  await save(a);
  return a;
}

export async function deleteSavedAudience(id: string): Promise<boolean> {
  const r = await prisma.savedAudience.deleteMany({ where: { id } });
  return r.count > 0;
}
