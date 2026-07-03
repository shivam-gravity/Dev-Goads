import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { getRawMetrics } from "../pipeline/performancePipeline.js";
import type { Invoice } from "../../types/index.js";

const PLATFORM_FEE_RATE = 0.12; // 12% of managed ad spend
const FLAT_MONTHLY_FEE_CENTS = 4900; // $49 base platform fee

/** Computes usage-based fees for a billing period: flat fee + percentage of ad spend managed. */
export function generateInvoice(businessId: string, periodStart: string, periodEnd: string): Invoice {
  const campaigns = listCampaignsForBusiness(businessId);

  let adSpendCents = 0;
  for (const campaign of campaigns) {
    const metrics = getRawMetrics(campaign.id).filter((m) => m.date >= periodStart && m.date <= periodEnd);
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

  db.prepare("INSERT INTO invoices (id, businessId, data, createdAt) VALUES (?, ?, ?, ?)").run(
    invoice.id,
    invoice.businessId,
    JSON.stringify(invoice),
    invoice.createdAt
  );

  return invoice;
}

export function listInvoices(businessId: string): Invoice[] {
  const rows = db.prepare("SELECT data FROM invoices WHERE businessId = ? ORDER BY createdAt DESC").all(businessId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}
