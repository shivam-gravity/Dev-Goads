import { randomUUID } from "node:crypto";
import { analyticsStore } from "../../infra/analyticsStore.js";
import { adapters } from "../orchestrator/campaignOrchestrator.js";
import { getCampaign } from "../orchestrator/campaignOrchestrator.js";
import { getMetaCredentials } from "../integrations/integrationService.js";
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
  const metaCredentials = (await getMetaCredentials(campaign.workspaceId ?? "demo")) ?? undefined;

  for (const variant of campaign.variants) {
    if (!variant.externalId) continue;
    const adapter = adapters[variant.network];
    const credentials = variant.network === "meta" ? metaCredentials : undefined;
    const raw = await adapter.fetchInsights(variant.externalId, date, credentials);

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
    const reach = metrics.reduce((s, m) => s + m.reach, 0);
    const clicks = metrics.reduce((s, m) => s + m.clicks, 0);
    const conversions = metrics.reduce((s, m) => s + m.conversions, 0);
    const spendCents = metrics.reduce((s, m) => s + m.spendCents, 0);
    const revenueCents = metrics.reduce((s, m) => s + (m.revenueCents ?? 0), 0);

    normalized.push({
      campaignId,
      variantId,
      network: metrics[0].network,
      impressions,
      reach,
      clicks,
      conversions,
      spendCents,
      revenueCents,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
      cpmCents: impressions > 0 ? Math.round((spendCents / impressions) * 1000) : null,
      cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : null,
      // True ROAS: real network-reported conversion value / spend. Null until real revenue exists.
      roas: spendCents > 0 && revenueCents > 0 ? revenueCents / spendCents : null,
      conversionRate: clicks > 0 ? conversions / clicks : 0,
    });
  }

  return normalized;
}

export interface LiveInsights {
  campaignId: string;
  isLive: boolean;
  impressions: number;
  reach: number;
  clicks: number;
  conversions: number;
  spendCents: number;
  revenueCents: number;
  ctr: number;
  cpcCents: number | null;
  cpmCents: number | null;
  roas: number | null;
}

/**
 * Flat, campaign-level rollup of normalizePerformance's per-variant rows into exactly the
 * fields the Live Insights Dashboard shows. isLive mirrors AdInsightsResponse.isDemo's
 * pattern of telling the frontend whether this reflects a real launch or just an
 * unlaunched draft with nothing ingested yet.
 */
export async function getLiveInsights(campaignId: string): Promise<LiveInsights> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const perVariant = await normalizePerformance(campaignId);
  const impressions = perVariant.reduce((s, p) => s + p.impressions, 0);
  const reach = perVariant.reduce((s, p) => s + p.reach, 0);
  const clicks = perVariant.reduce((s, p) => s + p.clicks, 0);
  const conversions = perVariant.reduce((s, p) => s + p.conversions, 0);
  const spendCents = perVariant.reduce((s, p) => s + p.spendCents, 0);
  const revenueCents = perVariant.reduce((s, p) => s + p.revenueCents, 0);

  return {
    campaignId,
    isLive: campaign.status === "active" || campaign.status === "paused",
    impressions,
    reach,
    clicks,
    conversions,
    spendCents,
    revenueCents,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : null,
    cpmCents: impressions > 0 ? Math.round((spendCents / impressions) * 1000) : null,
    roas: spendCents > 0 && revenueCents > 0 ? revenueCents / spendCents : null,
  };
}
