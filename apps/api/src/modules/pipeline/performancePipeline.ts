import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";
import { adapters } from "../orchestrator/campaignOrchestrator.js";
import { getCampaign } from "../orchestrator/campaignOrchestrator.js";
import type { NormalizedPerformance, PerformanceMetric } from "../../types/index.js";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pulls fresh insights for every launched variant in a campaign and stores raw metrics. */
export async function ingestCampaignMetrics(campaignId: string): Promise<PerformanceMetric[]> {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const date = todayISO();
  const results: PerformanceMetric[] = [];

  for (const variant of campaign.variants) {
    if (!variant.externalId) continue;
    const adapter = adapters[variant.network];
    const raw = await adapter.fetchInsights(variant.externalId, date);

    const metric: PerformanceMetric = {
      id: randomUUID(),
      campaignId,
      variantId: variant.id,
      network: variant.network,
      date,
      ...raw,
    };

    db.prepare("INSERT INTO metrics (id, campaignId, data, date) VALUES (?, ?, ?, ?)").run(
      metric.id,
      metric.campaignId,
      JSON.stringify(metric),
      metric.date
    );
    results.push(metric);
  }

  return results;
}

export function getRawMetrics(campaignId: string): PerformanceMetric[] {
  const rows = db.prepare("SELECT data FROM metrics WHERE campaignId = ? ORDER BY date DESC").all(campaignId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}

/** Aggregates raw metrics per variant into normalized rate stats used by the optimization engine. */
export function normalizePerformance(campaignId: string): NormalizedPerformance[] {
  const raw = getRawMetrics(campaignId);
  const byVariant = new Map<string, PerformanceMetric[]>();
  for (const m of raw) {
    const list = byVariant.get(m.variantId) ?? [];
    list.push(m);
    byVariant.set(m.variantId, list);
  }

  const normalized: NormalizedPerformance[] = [];
  for (const [variantId, metrics] of byVariant) {
    const impressions = metrics.reduce((s, m) => s + m.impressions, 0);
    const clicks = metrics.reduce((s, m) => s + m.clicks, 0);
    const conversions = metrics.reduce((s, m) => s + m.conversions, 0);
    const spendCents = metrics.reduce((s, m) => s + m.spendCents, 0);

    normalized.push({
      campaignId,
      variantId,
      network: metrics[0].network,
      impressions,
      clicks,
      conversions,
      spendCents,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
      conversionRate: clicks > 0 ? conversions / clicks : 0,
    });
  }

  return normalized;
}
