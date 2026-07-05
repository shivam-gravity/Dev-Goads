import { randomUUID } from "node:crypto";
import { analyticsStore } from "../../infra/analyticsStore.js";
import { adapters } from "../orchestrator/campaignOrchestrator.js";
import { getCampaign } from "../orchestrator/campaignOrchestrator.js";
import type { NormalizedPerformance, PerformanceMetric } from "../../types/index.js";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pulls fresh insights for every launched variant in a campaign and stores raw metrics. */
export async function ingestCampaignMetrics(campaignId: string): Promise<PerformanceMetric[]> {
  const campaign = await getCampaign(campaignId);
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

    await analyticsStore.recordMetric(metric);
    results.push(metric);
  }

  return results;
}

export async function getRawMetrics(campaignId: string): Promise<PerformanceMetric[]> {
  return analyticsStore.queryMetrics(campaignId);
}

/** Aggregates raw metrics per variant into normalized rate stats used by the optimization engine. */
export async function normalizePerformance(campaignId: string): Promise<NormalizedPerformance[]> {
  const raw = await getRawMetrics(campaignId);
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
