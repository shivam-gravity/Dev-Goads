import { randomUUID } from "node:crypto";
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

export async function createBusiness(input: Omit<BusinessProfile, "id">): Promise<BusinessProfile> {
  const business: BusinessProfile = { id: randomUUID(), ...input };
  await prisma.business.create({
    data: { id: business.id, domain: domainFromWebsite(business.website), data: business as any, createdAt: new Date() },
  });
  return business;
}

export async function getBusiness(id: string): Promise<BusinessProfile | null> {
  const row = await prisma.business.findUnique({ where: { id } });
  return row ? (row.data as unknown as BusinessProfile) : null;
}

export async function listBusinesses(): Promise<BusinessProfile[]> {
  const rows = await prisma.business.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as BusinessProfile);
}

export async function updateBusiness(id: string, patch: Partial<Omit<BusinessProfile, "id">>): Promise<BusinessProfile> {
  const existing = await getBusiness(id);
  if (!existing) throw new Error(`Business ${id} not found`);
  const updated: BusinessProfile = { ...existing, ...patch };
  await prisma.business.update({
    where: { id },
    data: { data: updated as any, ...(patch.website !== undefined ? { domain: domainFromWebsite(updated.website) } : {}) },
  });
  return updated;
}
