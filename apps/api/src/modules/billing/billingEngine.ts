import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { getRawMetrics } from "../pipeline/performancePipeline.js";
import type { Invoice } from "../../types/index.js";

const PLATFORM_FEE_RATE = 0.12; // 12% of managed ad spend
const FLAT_MONTHLY_FEE_CENTS = 4900; // $49 base platform fee

/** Computes usage-based fees for a billing period: flat fee + percentage of ad spend managed. */
export async function generateInvoice(businessId: string, periodStart: string, periodEnd: string): Promise<Invoice> {
  const campaigns = await listCampaignsForBusiness(businessId);

  let adSpendCents = 0;
  for (const campaign of campaigns) {
    const metrics = (await getRawMetrics(campaign.id)).filter((m) => m.date >= periodStart && m.date <= periodEnd);
    adSpendCents += metrics.reduce((sum, m) => sum + m.spendCents, 0);
  }

  const platformFeeCents = FLAT_MONTHLY_FEE_CENTS + Math.round(adSpendCents * PLATFORM_FEE_RATE);

  const invoice: Invoice = {
    id: randomUUID(),
    businessId,
    periodStart,
    periodEnd,
    adSpendCents,
    platformFeeCents,
    totalCents: adSpendCents + platformFeeCents,
    createdAt: new Date().toISOString(),
  };

  await prisma.invoice.create({
    data: { id: invoice.id, businessId: invoice.businessId, data: invoice as any, createdAt: new Date(invoice.createdAt) },
  });

  return invoice;
}

export async function listInvoices(businessId: string): Promise<Invoice[]> {
  const rows = await prisma.invoice.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as Invoice);
}
