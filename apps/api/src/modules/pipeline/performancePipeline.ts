import { randomUUID } from "node:crypto";
import { analyticsStore } from "../../infra/analyticsStore.js";
import { adapters } from "../orchestrator/campaignOrchestrator.js";
import { getCampaign } from "../orchestrator/campaignOrchestrator.js";
import type { NormalizedPerformance, PerformanceMetric } from "../../types/index.js";

/**
 * No real revenue-per-conversion tracking exists anywhere in this app (that requires a
 * pixel-fired purchase-value event, which the current mock/demo integrations don't carry) —
 * ROAS everywhere in the app is an estimate off this single assumed average order value.
 * Centralized here so analyticsService.ts's business-level ROAS and this module's
 * per-campaign ROAS never drift into two different hardcoded numbers.
 */
export const ESTIMATED_REVENUE_CENTS_PER_CONVERSION = 5000;

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
    const reach = metrics.reduce((s, m) => s + m.reach, 0);
    const clicks = metrics.reduce((s, m) => s + m.clicks, 0);
    const conversions = metrics.reduce((s, m) => s + m.conversions, 0);
    const spendCents = metrics.reduce((s, m) => s + m.spendCents, 0);

    normalized.push({
      campaignId,
      variantId,
      network: metrics[0].network,
      impressions,
      reach,
      clicks,
      conversions,
      spendCents,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
      cpmCents: impressions > 0 ? Math.round((spendCents / impressions) * 1000) : null,
      cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : null,
      roas: spendCents > 0 && conversions > 0 ? (conversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / spendCents : null,
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

  return {
    campaignId,
    isLive: campaign.status === "active" || campaign.status === "paused",
    impressions,
    reach,
    clicks,
    conversions,
    spendCents,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : null,
    cpmCents: impressions > 0 ? Math.round((spendCents / impressions) * 1000) : null,
    roas: spendCents > 0 && conversions > 0 ? (conversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / spendCents : null,
  };
}
