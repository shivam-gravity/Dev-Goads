import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { normalizePerformance } from "../pipeline/performancePipeline.js";
import type {
  AdInsightNetwork,
  AdInsightsResponse,
  AudienceInsightItem,
  CampaignVariant,
  CreativeInsightItem,
  DistributionSlice,
  NormalizedPerformance,
  PageInsightItem,
} from "../../types/index.js";

interface JoinedRow {
  campaignId: string;
  variant: CampaignVariant;
  perf: NormalizedPerformance;
}

async function collectJoinedRows(businessId: string, network: AdInsightNetwork): Promise<JoinedRow[]> {
  const campaigns = await listCampaignsForBusiness(businessId);
  const rows: JoinedRow[] = [];
  for (const campaign of campaigns) {
    const perfList = (await normalizePerformance(campaign.id)).filter((p) => p.network === network);
    for (const perf of perfList) {
      const variant = campaign.variants.find((v) => v.id === perf.variantId);
      if (variant) rows.push({ campaignId: campaign.id, variant, perf });
    }
  }
  return rows;
}

function computeTotals(rows: JoinedRow[]): AdInsightsResponse["totals"] {
  let spendCents = 0, impressions = 0, clicks = 0, conversions = 0, revenueCents = 0;
  for (const { perf } of rows) {
    spendCents += perf.spendCents;
    impressions += perf.impressions;
    clicks += perf.clicks;
    conversions += perf.conversions;
    revenueCents += perf.revenueCents;
  }
  return {
    spendCents,
    impressions,
    clicks,
    conversions,
    cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
    // True ROAS: real reported revenue / spend.
    roas: spendCents > 0 && revenueCents > 0 ? revenueCents / spendCents : null,
  };
}

function shareOf(map: Map<string, number>): DistributionSlice[] {
  const grand = Array.from(map.values()).reduce((s, v) => s + v, 0);
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, sharePct: grand > 0 ? Math.round((value / grand) * 1000) / 10 : 0 }))
    .sort((a, b) => b.sharePct - a.sharePct);
}

function buildRealInsights(rows: JoinedRow[], network: AdInsightNetwork): AdInsightsResponse {
  const audienceMap = new Map<string, { spendCents: number; conversions: number; campaignIds: Set<string> }>();
  const pageMap = new Map<string, { spendCents: number; clicks: number; conversions: number; campaignIds: Set<string> }>();
  const creativeMap = new Map<string, { creative: CampaignVariant["creative"]; clicks: number; impressions: number; spendCents: number; conversions: number; campaignIds: Set<string> }>();
  const audienceSpend = new Map<string, number>();
  const pageSpend = new Map<string, number>();

  for (const { campaignId, variant, perf } of rows) {
    const audienceName = variant.audienceName ?? "Unsegmented";
    const a = audienceMap.get(audienceName) ?? { spendCents: 0, conversions: 0, campaignIds: new Set<string>() };
    a.spendCents += perf.spendCents;
    a.conversions += perf.conversions;
    a.campaignIds.add(campaignId);
    audienceMap.set(audienceName, a);
    audienceSpend.set(audienceName, (audienceSpend.get(audienceName) ?? 0) + perf.spendCents);

    const pageUrl = variant.landingPageUrl ?? "—";
    const p = pageMap.get(pageUrl) ?? { spendCents: 0, clicks: 0, conversions: 0, campaignIds: new Set<string>() };
    p.spendCents += perf.spendCents;
    p.clicks += perf.clicks;
    p.conversions += perf.conversions;
    p.campaignIds.add(campaignId);
    pageMap.set(pageUrl, p);
    pageSpend.set(pageUrl, (pageSpend.get(pageUrl) ?? 0) + perf.spendCents);

    const creativeKey = `${variant.id}`;
    const c = creativeMap.get(creativeKey) ?? { creative: variant.creative, clicks: 0, impressions: 0, spendCents: 0, conversions: 0, campaignIds: new Set<string>() };
    c.clicks += perf.clicks;
    c.impressions += perf.impressions;
    c.spendCents += perf.spendCents;
    c.conversions += perf.conversions;
    c.campaignIds.add(campaignId);
    creativeMap.set(creativeKey, c);
  }

  const topAudiences: AudienceInsightItem[] = Array.from(audienceMap.entries())
    .map(([name, v]) => ({
      name,
      tags: [] as string[],
      cpaCents: v.conversions > 0 ? Math.round(v.spendCents / v.conversions) : null,
      spendCents: v.spendCents,
      campaignCount: v.campaignIds.size,
    }))
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, 5);

  const topPages: PageInsightItem[] = Array.from(pageMap.entries())
    .map(([url, v]) => ({
      url,
      cvr: v.clicks > 0 ? Math.round((v.conversions / v.clicks) * 10000) / 100 : 0,
      spendCents: v.spendCents,
      campaignCount: v.campaignIds.size,
    }))
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, 5);

  const creativeEntries = Array.from(creativeMap.entries());
  const scatter = creativeEntries.map(([id, v]) => ({
    id,
    ctr: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
    cpaCents: v.conversions > 0 ? Math.round(v.spendCents / v.conversions) : 0,
  }));

  const topAds: CreativeInsightItem[] = creativeEntries
    .map(([id, v]) => ({
      id,
      headline: v.creative.headline,
      body: v.creative.body,
      imageUrl: v.creative.imageUrl,
      ctr: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
      cpaCents: v.conversions > 0 ? Math.round(v.spendCents / v.conversions) : null,
      campaignCount: v.campaignIds.size,
    }))
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 3);

  return {
    network,
    isDemo: false,
    totals: computeTotals(rows),
    audience: { distribution: shareOf(audienceSpend), top: topAudiences },
    pages: { distribution: shareOf(pageSpend), top: topPages },
    creative: { scatter, topAds },
  };
}

/**
 * Honest EMPTY insights — returned when there is no real ad-performance data for this business/
 * network yet (no connected Meta/Google account has reported metrics). Replaces the former
 * buildDemoInsights (hardcoded "High-Intent Shoppers"/example.com fabrications) and the
 * Math.random()-synthesized buildInsightsFromCampaignData: the Ads Manager must never show
 * invented spend/conversion/ROAS numbers. `isDemo: true` signals the UI to render a "no data yet —
 * connect an account" empty state rather than these zeros as if they were real performance.
 */
function buildEmptyInsights(network: AdInsightNetwork): AdInsightsResponse {
  return {
    network,
    isDemo: true,
    totals: { spendCents: 0, impressions: 0, clicks: 0, conversions: 0, cpaCents: null, roas: null },
    audience: { distribution: [], top: [] },
    pages: { distribution: [], top: [] },
    creative: { scatter: [], topAds: [] },
  };
}

export async function getAdInsights(businessId: string, network: AdInsightNetwork): Promise<AdInsightsResponse> {
  const rows = await collectJoinedRows(businessId, network);
  // ONLY real, reported ad-performance rows produce insights. When there are none, return an honest
  // empty state — never fabricated demo numbers or budget-synthesized estimates (both removed): the
  // Ads Manager must show real Meta/Google performance or nothing, not invented data.
  if (rows.length > 0) return buildRealInsights(rows, network);
  return buildEmptyInsights(network);
}
