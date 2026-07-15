import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { BusinessProfile } from "../../types/index.js";

/** Normalized domain (lowercase hostname, www. stripped) from a website URL — the queryable
 * website-level identity column, vs. the raw `website` string inside the JSON blob which can
 * carry any scheme/path/casing the user typed. Null when the URL doesn't parse. */
export function domainFromWebsite(website?: string): string | null {
  if (!website) return null;
  const withScheme = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

// workspaceId is persisted on the relational `Business.workspaceId` column (indexed, and
// what requireBusinessAccess/getMembership actually check against) rather than inside the
// `data` JSON blob — toBusinessProfile merges it back onto the returned object so every
// caller can read it without a second query, while stripWorkspaceId keeps it out of what
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
  try {
    await prisma.business.create({
      data: { id, workspaceId, domain: domainFromWebsite(profile.website), data: { id, ...profile } as any, createdAt: new Date() },
    });
  } catch (err) {
    // P2002 here is always the @@unique([workspaceId, domain]) constraint (the only unique
    // index on this table) — a foreseeable "you already have a business at this domain"
    // conflict, not an infra failure. Re-thrown as a plain Error so gateway/errorResponse.ts's
    // sendError() reports it as the caller-supplied 4xx instead of misclassifying it as infra
    // (its isInfraError check treats every raw PrismaClientKnownRequestError as a 500).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error("A business with this website domain already exists in this workspace.");
    }
    throw err;
  }
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
  await prisma.business.update({
    where: { id },
    data: {
      data: stripWorkspaceId(updated) as any,
      ...(patch.website !== undefined ? { domain: domainFromWebsite(updated.website) } : {}),
    },
  });
  return updated;
}
