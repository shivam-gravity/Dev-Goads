import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export type AudienceType = "saved" | "custom" | "lookalike" | "interest_group";
export type AudiencePlatform = "meta" | "google";

export interface SavedAudience {
  id: string;
  workspaceId: string;
  name: string;
  // Optional so ephemeral (non-persisted) and test-fixture audiences don't need to set it —
  // normalizeAudience() below guarantees "saved" as the default for anything actually stored.
  type?: AudienceType;
  platform?: AudiencePlatform | null;
  // Only meaningful when type === "lookalike" — references another SavedAudience.id used
  // as the seed. This is Polluxa's own bookkeeping only, not a real Meta/Google seed linkage.
  lookalikeSourceId?: string | null;
  // The real Meta Custom/Lookalike Audience id returned by the Graph API when this audience was
  // created there (metaAudienceSync.createCustomAudience/createLookalikeAudience). Present for
  // type "custom"/"lookalike"; it's what gets injected into ad-set targeting.custom_audiences so a
  // launched Meta ad set actually targets this audience. Null for plain interest/geo "saved" audiences.
  metaCustomAudienceId?: string | null;
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

// Rows created before `type`/`platform`/`lookalikeSourceId` existed have none of these keys in
// their stored JSON — default them here on read rather than backfilling, so old audiences keep
// working as plain "saved" audiences instead of surfacing `undefined`.
function normalizeAudience(raw: unknown): SavedAudience {
  return { type: "saved", platform: null, lookalikeSourceId: null, metaCustomAudienceId: null, ...(raw as Partial<SavedAudience>) } as SavedAudience;
}

export async function listSavedAudiences(workspaceId: string): Promise<SavedAudience[]> {
  const rows = await prisma.savedAudience.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => normalizeAudience(r.data));
}

export async function getSavedAudience(id: string): Promise<SavedAudience | null> {
  const row = await prisma.savedAudience.findUnique({ where: { id } });
  return row ? normalizeAudience(row.data) : null;
}

export async function createSavedAudience(
  workspaceId: string,
  input: Omit<SavedAudience, "id" | "workspaceId" | "createdAt">
): Promise<SavedAudience> {
  // No DB-level unique constraint on name (SavedAudience.data is a JSON blob, not a
  // dedicated column), so a double-submit (double-click "Save", a retried request) would
  // otherwise silently create two identical-looking rows in the Audience Segments Library.
  // Case/whitespace-insensitive since "Dup Audience" and "dup audience " are the same
  // collision from a user's point of view.
  const existing = await listSavedAudiences(workspaceId);
  const normalizedName = input.name.trim().toLowerCase();
  if (existing.some((a) => a.name.trim().toLowerCase() === normalizedName)) {
    throw new Error(`An audience named "${input.name}" already exists in this workspace.`);
  }
  const a: SavedAudience = { id: randomUUID(), workspaceId, createdAt: new Date().toISOString(), ...input };
  await save(a);
  return a;
}

export async function updateSavedAudience(id: string, patch: Partial<Omit<SavedAudience, "id" | "workspaceId" | "createdAt">>): Promise<SavedAudience> {
  const row = await prisma.savedAudience.findUnique({ where: { id } });
  if (!row) throw new Error("Saved audience not found");
  const a: SavedAudience = { ...normalizeAudience(row.data), ...patch };
  await save(a);
  return a;
}

export async function deleteSavedAudience(id: string): Promise<boolean> {
  const r = await prisma.savedAudience.deleteMany({ where: { id } });
  return r.count > 0;
}
