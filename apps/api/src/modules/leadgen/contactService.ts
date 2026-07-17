import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import type { LeadPlatform, PageResult } from "./leadIngestionService.js";

export interface ContactRecord {
  id: string;
  workspaceId: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  companyName: string | null;
  leadCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  platforms: LeadPlatform[];
}

export interface UpsertContactForLeadInput {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  submittedAt: Date;
}

/**
 * The Stage-C "Normalizer" — merges a newly-ingested Lead into a workspace-scoped Contact,
 * matching by email first (the stronger identity signal) then falling back to phone. Returns
 * null when neither is present, since there's nothing to dedupe a Contact identity on.
 * Callers must only invoke this once per genuinely new Lead row (not on upsert redelivery),
 * since leadCount is incremented unconditionally here.
 */
export async function upsertContactForLead(workspaceId: string, input: UpsertContactForLeadInput): Promise<string | null> {
  const email = input.email ?? null;
  const phone = input.phone ?? null;
  if (!email && !phone) return null;

  const existing = await prisma.contact.findFirst({
    where: { workspaceId, ...(email ? { email } : { phone } ) },
  });

  if (existing) {
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        fullName: input.fullName ?? existing.fullName,
        companyName: input.companyName ?? existing.companyName,
        lastSeenAt: input.submittedAt > existing.lastSeenAt ? input.submittedAt : existing.lastSeenAt,
        leadCount: { increment: 1 },
      },
    });
    return existing.id;
  }

  const created = await prisma.contact.create({
    data: {
      id: randomUUID(),
      workspaceId,
      email,
      phone,
      fullName: input.fullName ?? null,
      companyName: input.companyName ?? null,
      leadCount: 1,
      firstSeenAt: input.submittedAt,
      lastSeenAt: input.submittedAt,
    },
  });
  return created.id;
}

export async function listContacts(workspaceId: string, opts: { page?: number; pageSize?: number } = {}): Promise<PageResult<ContactRecord>> {
  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : 10;
  const where = { workspaceId };
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { leads: { select: { platform: true } } },
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      email: row.email,
      phone: row.phone,
      fullName: row.fullName,
      companyName: row.companyName,
      leadCount: row.leadCount,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      platforms: [...new Set(row.leads.map((l) => l.platform as LeadPlatform))],
    })),
    total,
  };
}
