import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { upsertContactForLead } from "./contactService.js";
import { dispatchCrmWebhook } from "../crm/crmWebhookService.js";

export type LeadPlatform = "meta" | "google";

export interface LeadFormRecord {
  id: string;
  workspaceId: string;
  platform: LeadPlatform;
  externalId: string;
  campaignId: string | null;
  name: string;
  status: string;
  data: Record<string, unknown>;
}

export interface LeadRecord {
  id: string;
  workspaceId: string;
  platform: LeadPlatform;
  externalId: string;
  leadFormId: string | null;
  formExternalId: string | null;
  campaignId: string | null;
  adId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  submittedAt: Date;
  data: Record<string, unknown>;
  contactId: string | null;
}

export interface UpsertLeadFormInput {
  workspaceId: string;
  platform: LeadPlatform;
  externalId: string;
  name: string;
  campaignId?: string | null;
  data: Record<string, unknown>;
}

/** Upserts a lead form on (workspaceId, platform, externalId) — safe to call repeatedly as the source form definition changes. */
export async function upsertLeadForm(input: UpsertLeadFormInput): Promise<LeadFormRecord> {
  const row = await prisma.leadForm.upsert({
    where: { workspaceId_platform_externalId: { workspaceId: input.workspaceId, platform: input.platform, externalId: input.externalId } },
    create: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalId: input.externalId,
      name: input.name,
      campaignId: input.campaignId ?? null,
      data: input.data as any,
    },
    update: {
      name: input.name,
      campaignId: input.campaignId ?? null,
      data: input.data as any,
      updatedAt: new Date(),
    },
  });
  return toLeadFormRecord(row);
}

export interface IngestLeadInput {
  workspaceId: string;
  platform: LeadPlatform;
  externalId: string;
  formExternalId?: string | null;
  campaignId?: string | null;
  adId?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  submittedAt: Date;
  data: Record<string, unknown>;
}

/**
 * Upserts a single lead on (workspaceId, platform, externalId) — the shared entry point
 * for both the Meta webhook (which redelivers) and the Meta/Google backfill/poll jobs,
 * so both paths stay idempotent through the same unique constraint.
 */
export async function ingestLead(input: IngestLeadInput): Promise<LeadRecord> {
  let leadFormId: string | null = null;
  if (input.formExternalId) {
    const form = await prisma.leadForm.findUnique({
      where: { workspaceId_platform_externalId: { workspaceId: input.workspaceId, platform: input.platform, externalId: input.formExternalId } },
    });
    leadFormId = form?.id ?? null;
  }

  const uniqueWhere = { workspaceId_platform_externalId: { workspaceId: input.workspaceId, platform: input.platform, externalId: input.externalId } };
  const existingLead = await prisma.lead.findUnique({ where: uniqueWhere });

  let row = await prisma.lead.upsert({
    where: uniqueWhere,
    create: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalId: input.externalId,
      leadFormId,
      campaignId: input.campaignId ?? null,
      adId: input.adId ?? null,
      fullName: input.fullName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      companyName: input.companyName ?? null,
      submittedAt: input.submittedAt,
      data: input.data as any,
    },
    update: {
      leadFormId,
      campaignId: input.campaignId ?? null,
      adId: input.adId ?? null,
      fullName: input.fullName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      companyName: input.companyName ?? null,
      data: input.data as any,
    },
  });

  // Only normalize into a Contact (and fire the CRM webhook) on genuinely new leads —
  // ingestLead is called on every webhook redelivery and backfill re-run, and both
  // upsertContactForLead's leadCount increment and a webhook push would otherwise double-fire.
  if (!existingLead) {
    const contactId = await upsertContactForLead(input.workspaceId, {
      email: input.email ?? null,
      phone: input.phone ?? null,
      fullName: input.fullName ?? null,
      companyName: input.companyName ?? null,
      submittedAt: input.submittedAt,
    });
    if (contactId) {
      row = await prisma.lead.update({ where: { id: row.id }, data: { contactId } });
    }

    const record = toLeadRecord(row, input.formExternalId ?? null);
    await dispatchCrmWebhook({ workspaceId: input.workspaceId, event: "lead.created", payload: toCrmLeadPayload(record) });
    return record;
  }

  return toLeadRecord(row, input.formExternalId ?? null);
}

/** Shared lead → CRM JSON shape, used by both the polled /ads-data/leads route and the pushed lead.created webhook, so the two never drift apart. */
export function toCrmLeadPayload(lead: LeadRecord): Record<string, unknown> {
  return {
    id: lead.id,
    form_id: lead.formExternalId,
    field_data: lead.data,
    created_at: lead.submittedAt.toISOString(),
    platform: lead.platform,
    contact_id: lead.contactId,
  };
}

export interface PageResult<T> {
  data: T[];
  total: number;
}

export async function listLeadForms(workspaceId: string, opts: { platform?: LeadPlatform; page?: number; pageSize?: number } = {}): Promise<PageResult<LeadFormRecord>> {
  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : 10;
  const where = { workspaceId, ...(opts.platform ? { platform: opts.platform } : {}) };
  const [rows, total] = await Promise.all([
    prisma.leadForm.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.leadForm.count({ where }),
  ]);
  return { data: rows.map(toLeadFormRecord), total };
}

export async function listLeads(
  workspaceId: string,
  opts: { platform?: LeadPlatform; formId?: string; campaignId?: string; page?: number; pageSize?: number } = {}
): Promise<PageResult<LeadRecord>> {
  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts.pageSize && opts.pageSize > 0 ? opts.pageSize : 10;
  const where = {
    workspaceId,
    ...(opts.platform ? { platform: opts.platform } : {}),
    ...(opts.formId ? { leadFormId: opts.formId } : {}),
    ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { submittedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { leadForm: true } }),
    prisma.lead.count({ where }),
  ]);
  return { data: rows.map((r) => toLeadRecord(r, r.leadForm?.externalId ?? null)), total };
}

function toLeadFormRecord(row: { id: string; workspaceId: string; platform: string; externalId: string; campaignId: string | null; name: string; status: string; data: unknown }): LeadFormRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    platform: row.platform as LeadPlatform,
    externalId: row.externalId,
    campaignId: row.campaignId,
    name: row.name,
    status: row.status,
    data: (row.data as Record<string, unknown>) ?? {},
  };
}

function toLeadRecord(
  row: {
    id: string; workspaceId: string; platform: string; externalId: string; leadFormId: string | null;
    campaignId: string | null; adId: string | null; fullName: string | null; email: string | null;
    phone: string | null; companyName: string | null; submittedAt: Date; data: unknown; contactId: string | null;
  },
  formExternalId: string | null
): LeadRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    platform: row.platform as LeadPlatform,
    externalId: row.externalId,
    leadFormId: row.leadFormId,
    formExternalId,
    campaignId: row.campaignId,
    adId: row.adId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    companyName: row.companyName,
    submittedAt: row.submittedAt,
    data: (row.data as Record<string, unknown>) ?? {},
    contactId: row.contactId,
  };
}

const MOCK_FORM_TEMPLATES: Record<LeadPlatform, { name: string; headline: string; business_name: string; call_to_action_type: string; fields: string[] }[]> = {
  meta: [
    { name: "Get a Free Quote", headline: "See your custom quote in 60 seconds", business_name: "Polluxa Demo Store", call_to_action_type: "GET_QUOTE", fields: ["FULL_NAME", "EMAIL", "PHONE_NUMBER"] },
  ],
  google: [
    { name: "Request a Callback", headline: "Talk to our team today", business_name: "Polluxa Demo Store", call_to_action_type: "CALL_NOW", fields: ["FULL_NAME", "PHONE_NUMBER", "EMAIL"] },
  ],
};

const MOCK_LEAD_NAMES = ["Priya Sharma", "Arjun Mehta", "Sara Khan", "Rohan Gupta", "Neha Verma"];

/**
 * Lazily seeds believable LeadForm/Lead rows the first time a workspace has none for a
 * platform — mirrors the seedDemoAssets/seedDemoDrafts/seedDemoInsights idiom used
 * elsewhere, so CRM tabs render plausible data before real Meta/Google credentials exist.
 */
export async function seedMockLeadData(workspaceId: string, platform: LeadPlatform): Promise<void> {
  const existing = await prisma.leadForm.findFirst({ where: { workspaceId, platform } });
  if (existing) return;

  for (const [i, template] of MOCK_FORM_TEMPLATES[platform].entries()) {
    const form = await upsertLeadForm({
      workspaceId,
      platform,
      externalId: `mock-form-${platform}-${i + 1}`,
      name: template.name,
      data: template,
    });

    for (let n = 0; n < MOCK_LEAD_NAMES.length; n++) {
      const fullName = MOCK_LEAD_NAMES[n];
      const email = `${fullName.toLowerCase().replace(/\s+/g, ".")}@example.com`;
      const submittedAt = new Date(Date.now() - n * 6 * 60 * 60 * 1000);
      await ingestLead({
        workspaceId,
        platform,
        externalId: `mock-lead-${platform}-${i + 1}-${n + 1}`,
        formExternalId: form.externalId,
        fullName,
        email,
        phone: `+91 90000${(10000 + n).toString().slice(-5)}`,
        submittedAt,
        data: { FULL_NAME: fullName, EMAIL: email, PHONE_NUMBER: `+91 90000${(10000 + n).toString().slice(-5)}` },
      });
    }
  }
}
