import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import type { BusinessProfile } from "../../types/index.js";

// workspaceId is persisted on the relational `Business.workspaceId` column (indexed, and
// what requireBusinessAccess/getMembership actually check against) rather than inside the
// `data` JSON blob — toBusinessProfile merges it back onto the returned object so every
// caller can read it without a second query, while stripBusinessData keeps it out of what
// actually gets written to `data`, so there's exactly one place it's stored.
function toBusinessProfile(row: { workspaceId: string | null; data: unknown }): BusinessProfile {
  return { ...(row.data as BusinessProfile), workspaceId: row.workspaceId ?? undefined };
}

function stripWorkspaceId(profile: BusinessProfile): Omit<BusinessProfile, "workspaceId"> {
  const { workspaceId: _workspaceId, ...rest } = profile;
  return rest;
}

export async function createBusiness(input: Omit<BusinessProfile, "id">): Promise<BusinessProfile> {
  const { workspaceId, ...profile } = input;
  const id = randomUUID();
  await prisma.business.create({
    data: { id, workspaceId, data: { id, ...profile } as any, createdAt: new Date() },
  });
  return { id, workspaceId, ...profile };
}

export async function getBusiness(id: string): Promise<BusinessProfile | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? toBusinessProfile(row) : null;
}

export async function listBusinesses(workspaceId?: string): Promise<BusinessProfile[]> {
  const rows = await prisma.business.findMany({
    where: workspaceId ? { workspaceId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toBusinessProfile);
}

// workspaceId is deliberately not accepted here — reassigning a business to a different
// workspace after the fact is a separate, more sensitive operation than a normal profile
// edit (it would silently move a customer's data across tenants), and nothing needs it yet.
export async function updateBusiness(id: string, patch: Partial<Omit<BusinessProfile, "id" | "workspaceId">>): Promise<BusinessProfile> {
  const existing = await getBusiness(id);
  if (!existing) throw new Error(`Business ${id} not found`);
  const updated: BusinessProfile = { ...existing, ...patch };
  await prisma.business.update({ where: { id }, data: { data: stripWorkspaceId(updated) as any } });
  return updated;
}
