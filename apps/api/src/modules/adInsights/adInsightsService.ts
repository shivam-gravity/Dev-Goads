import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { normalizePerformance, ESTIMATED_REVENUE_CENTS_PER_CONVERSION } from "../pipeline/performancePipeline.js";
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
  let spendCents = 0, impressions = 0, clicks = 0, conversions = 0;
  for (const { perf } of rows) {
    spendCents += perf.spendCents;
    impressions += perf.impressions;
    clicks += perf.clicks;
    conversions += perf.conversions;
  }
  return {
    spendCents,
    impressions,
    clicks,
    conversions,
    cpaCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
    roas: spendCents > 0 && conversions > 0 ? (conversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / spendCents : null,
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

const PLACEHOLDER_IMAGE = (seed: string) => `https://placehold.co/600x400/7033f5/ffffff?text=${encodeURIComponent(seed)}`;

function buildDemoInsights(network: AdInsightNetwork): AdInsightsResponse {
  const demoSpendCents = 158038;
  const demoConversions = 27;
  return {
    network,
    isDemo: true,
    totals: {
      spendCents: demoSpendCents,
      impressions: 420_000,
      clicks: 9800,
      conversions: demoConversions,
      cpaCents: Math.round(demoSpendCents / demoConversions),
      roas: (demoConversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / demoSpendCents,
    },
    audience: {
      distribution: [
        { label: "High-Intent Shoppers", sharePct: 42 },
        { label: "Retargeting Visitors", sharePct: 27 },
        { label: "Lookalike Audience", sharePct: 18 },
        { label: "Others", sharePct: 13 },
      ],
      top: [
        { name: "High-Intent Shoppers", tags: ["In-market", "Comparison shoppers", "Deal seekers"], cpaCents: 280, spendCents: 45500, campaignCount: 11 },
        { name: "Retargeting Visitors", tags: ["Cart abandoners", "Site visitors 30d", "Email subscribers"], cpaCents: 150, spendCents: 28200, campaignCount: 8 },
        { name: "Lookalike Audience", tags: ["1% lookalike", "Customer match", "Similar interests"], cpaCents: 220, spendCents: 10100, campaignCount: 9 },
      ],
    },
    pages: {
      distribution: [
        { label: "example.com/", sharePct: 62 },
        { label: "example.com/pricing", sharePct: 38 },
      ],
      top: [
        { url: "example.com/", cvr: 1.72, spendCents: 67500, campaignCount: 2 },
        { url: "example.com/pricing", cvr: 2.41, spendCents: 32000, campaignCount: 3 },
      ],
    },
    creative: {
      scatter: [
        { id: "c1", ctr: 1.0, cpaCents: 280 },
        { id: "c2", ctr: 2.4, cpaCents: 780 },
        { id: "c3", ctr: 3.1, cpaCents: 260 },
        { id: "c4", ctr: 3.3, cpaCents: 250 },
        { id: "c5", ctr: 6.0, cpaCents: 560 },
        { id: "c6", ctr: 6.95, cpaCents: 370 },
        { id: "c7", ctr: 7.0, cpaCents: 300 },
        { id: "c8", ctr: 7.1, cpaCents: 210 },
      ],
      topAds: [
        { id: "c2", headline: "Discover What Makes Us Different", body: "Enjoy a personalized experience crafted around what matters most to you.", imageUrl: PLACEHOLDER_IMAGE("Ad Creative 1"), ctr: 2.38, cpaCents: 780, campaignCount: 12 },
        { id: "c6", headline: "Limited Time Offer Inside", body: "Craving something new? Discover our top-rated picks near you.", imageUrl: PLACEHOLDER_IMAGE("Ad Creative 2"), ctr: 6.95, cpaCents: 370, campaignCount: 10 },
        { id: "c5", headline: "Join Thousands of Happy Customers", body: "See why our community keeps coming back for more.", imageUrl: PLACEHOLDER_IMAGE("Ad Creative 3"), ctr: 6.12, cpaCents: 560, campaignCount: 7 },
      ],
    },
  };
}

function buildInsightsFromCampaignData(businessId: string, campaigns: { id: string; variants: CampaignVariant[]; dailyBudgetCents: number; name: string }[], network: AdInsightNetwork): AdInsightsResponse {
  const networkVariants = campaigns.flatMap((c) =>
    c.variants.filter((v) => v.network === network).map((v) => ({ campaignId: c.id, variant: v, budget: c.dailyBudgetCents }))
  );
  if (networkVariants.length === 0) return buildDemoInsights(network);

  const totalBudgetCents = networkVariants.reduce((s, r) => s + Math.round(r.budget / campaigns[0].variants.length), 0);
  const avgCpm = network === "google" ? 2800 : 1200;
  const avgCtr = network === "google" ? 0.035 : 0.012;
  const avgCvr = 0.028;

  const audienceSpend = new Map<string, number>();
  const audienceData = new Map<string, { spendCents: number; conversions: number; campaignIds: Set<string> }>();
  const pageSpend = new Map<string, number>();
  const pageData = new Map<string, { spendCents: number; clicks: number; conversions: number; campaignIds: Set<string> }>();
  const creativeData = new Map<string, { creative: CampaignVariant["creative"]; clicks: number; impressions: number; spendCents: number; conversions: number; campaignIds: Set<string> }>();

  for (const { campaignId, variant, budget } of networkVariants) {
    const variantBudget = Math.round(budget / campaigns.find((c) => c.id === campaignId)!.variants.length);
    const impressions = Math.round((variantBudget / avgCpm) * 1000);
    const clicks = Math.round(impressions * avgCtr * (0.7 + Math.random() * 0.6));
    const conversions = Math.max(1, Math.round(clicks * avgCvr * (0.5 + Math.random() * 1.0)));

    const audienceName = variant.audienceName ?? "General Audience";
    const a = audienceData.get(audienceName) ?? { spendCents: 0, conversions: 0, campaignIds: new Set<string>() };
    a.spendCents += variantBudget;
    a.conversions += conversions;
    a.campaignIds.add(campaignId);
    audienceData.set(audienceName, a);
    audienceSpend.set(audienceName, (audienceSpend.get(audienceName) ?? 0) + variantBudget);

    const pageUrl = variant.landingPageUrl ?? "https://example.com/";
    const p = pageData.get(pageUrl) ?? { spendCents: 0, clicks: 0, conversions: 0, campaignIds: new Set<string>() };
    p.spendCents += variantBudget;
    p.clicks += clicks;
    p.conversions += conversions;
    p.campaignIds.add(campaignId);
    pageData.set(pageUrl, p);
    pageSpend.set(pageUrl, (pageSpend.get(pageUrl) ?? 0) + variantBudget);

    const c = creativeData.get(variant.id) ?? { creative: variant.creative, clicks: 0, impressions: 0, spendCents: 0, conversions: 0, campaignIds: new Set<string>() };
    c.clicks += clicks;
    c.impressions += impressions;
    c.spendCents += variantBudget;
    c.conversions += conversions;
    c.campaignIds.add(campaignId);
    creativeData.set(variant.id, c);
  }

  const totalImpressions = Array.from(creativeData.values()).reduce((s, v) => s + v.impressions, 0);
  const totalClicks = Array.from(creativeData.values()).reduce((s, v) => s + v.clicks, 0);
  const totalConversions = Array.from(creativeData.values()).reduce((s, v) => s + v.conversions, 0);

  const topAudiences: AudienceInsightItem[] = Array.from(audienceData.entries())
    .map(([name, v]) => ({ name, tags: [], cpaCents: v.conversions > 0 ? Math.round(v.spendCents / v.conversions) : null, spendCents: v.spendCents, campaignCount: v.campaignIds.size }))
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, 5);

  const topPages: PageInsightItem[] = Array.from(pageData.entries())
    .map(([url, v]) => ({ url, cvr: v.clicks > 0 ? Math.round((v.conversions / v.clicks) * 10000) / 100 : 0, spendCents: v.spendCents, campaignCount: v.campaignIds.size }))
    .sort((a, b) => b.spendCents - a.spendCents)
    .slice(0, 5);

  const creativeEntries = Array.from(creativeData.entries());
  const scatter = creativeEntries.map(([id, v]) => ({
    id,
    ctr: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
    cpaCents: v.conversions > 0 ? Math.round(v.spendCents / v.conversions) : 0,
  }));

  const topAds: CreativeInsightItem[] = creativeEntries
    .map(([id, v]) => ({ id, headline: v.creative.headline, body: v.creative.body, imageUrl: v.creative.imageUrl, ctr: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0, cpaCents: v.conversions > 0 ? Math.round(v.spendCents / v.conversions) : null, campaignCount: v.campaignIds.size }))
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 3);

  return {
    network,
    isDemo: false,
    totals: { spendCents: totalBudgetCents, impressions: totalImpressions, clicks: totalClicks, conversions: totalConversions, cpaCents: totalConversions > 0 ? Math.round(totalBudgetCents / totalConversions) : null, roas: totalBudgetCents > 0 && totalConversions > 0 ? (totalConversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / totalBudgetCents : null },
    audience: { distribution: shareOf(audienceSpend), top: topAudiences },
    pages: { distribution: shareOf(pageSpend), top: topPages },
    creative: { scatter, topAds },
  };
}

export async function getAdInsights(businessId: string, network: AdInsightNetwork): Promise<AdInsightsResponse> {
  const rows = await collectJoinedRows(businessId, network);
  if (rows.length > 0) return buildRealInsights(rows, network);
  const campaigns = await listCampaignsForBusiness(businessId);
  const withVariants = campaigns.filter((c) => c.variants.some((v) => v.network === network));
  if (withVariants.length > 0) return buildInsightsFromCampaignData(businessId, withVariants, network);
  return buildDemoInsights(network);
}
