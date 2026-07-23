import { llm, runStructured } from "../../infra/llmClient.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { normalizePerformance, getRawMetrics } from "../pipeline/performancePipeline.js";
import { getBusiness } from "../business/businessService.js";
import type { AnalyticsSummary, TrendPoint, AudienceSuggestion, AdNetwork } from "../../types/index.js";

export async function getAnalyticsSummary(businessId: string, period: "all" | "month" | "week" = "all"): Promise<AnalyticsSummary> {
  const campaigns = await listCampaignsForBusiness(businessId);
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;

  let totalSpendCents = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalConversions = 0;
  let totalRevenueCents = 0;

  // Date filter
  const now = new Date();
  let cutoff: Date | null = null;
  if (period === "week") cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (period === "month") cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const campaign of campaigns) {
    // Apply period filter on raw metrics if needed
    if (cutoff) {
      const raw = (await getRawMetrics(campaign.id)).filter((m) => new Date(m.date) >= cutoff!);
      for (const m of raw) {
        totalSpendCents += m.spendCents;
        totalImpressions += m.impressions;
        totalClicks += m.clicks;
        totalConversions += m.conversions;
        totalRevenueCents += m.revenueCents ?? 0;
      }
    } else {
      const perf = await normalizePerformance(campaign.id);
      for (const p of perf) {
        totalSpendCents += p.spendCents;
        totalImpressions += p.impressions;
        totalClicks += p.clicks;
        totalConversions += p.conversions;
        totalRevenueCents += p.revenueCents;
      }
    }
  }

  // No budget-guess fabrication: if there are no real reported metrics, the totals stay 0 and the
  // UI shows an honest "no performance data yet" state. Previously this synthesized impressions/
  // clicks/conversions from daily budget × assumed CPM/CTR/CVR and showed them as real analytics.

  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgCpc = totalClicks > 0 ? totalSpendCents / totalClicks : null;
  // True ROAS: real reported revenue / spend.
  const roas = totalSpendCents > 0 && totalRevenueCents > 0 ? totalRevenueCents / totalSpendCents : null;

  return {
    businessId,
    totalSpendCents,
    totalImpressions,
    totalClicks,
    totalConversions,
    avgCtr,
    avgCpc,
    roas,
    activeCampaigns,
    period,
  };
}

export async function getCampaignTrend(campaignId: string): Promise<TrendPoint[]> {
  const raw = await getRawMetrics(campaignId);

  if (raw.length > 0) {
    const byDate = new Map<string, typeof raw>();
    for (const m of raw) {
      const list = byDate.get(m.date) ?? [];
      list.push(m);
      byDate.set(m.date, list);
    }
    const points: TrendPoint[] = [];
    for (const [date, metrics] of byDate) {
      const impressions = metrics.reduce((s, m) => s + m.impressions, 0);
      const clicks = metrics.reduce((s, m) => s + m.clicks, 0);
      const conversions = metrics.reduce((s, m) => s + m.conversions, 0);
      const spendCents = metrics.reduce((s, m) => s + m.spendCents, 0);
      points.push({ date, impressions, clicks, conversions, spendCents, ctr: impressions > 0 ? clicks / impressions : 0 });
    }
    return points.sort((a, b) => a.date.localeCompare(b.date));
  }

  // No real daily metrics → return an empty trend (the chart shows its "no data yet" state). This
  // replaces a fabricated 7-day trend synthesized from daily budget × assumed CPM/CTR/CVR, which
  // rendered as a real performance chart.
  return [];
}

const AUDIENCE_SUGGESTION_TOOL = {
  name: "emit_audience_suggestions",
  description: "Generate 4-6 detailed audience segment suggestions for an ad campaign.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            estimatedReach: { type: "string", description: "e.g. '2M–5M on Meta'" },
            platforms: { type: "array", items: { type: "string", enum: ["meta", "google"] } },
            interests: { type: "array", items: { type: "string" } },
            demographics: { type: "string", description: "e.g. 'Ages 25–44, professionals'" },
            painPoints: { type: "array", items: { type: "string" } },
            buyingIntent: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["name", "description", "estimatedReach", "platforms", "interests", "demographics", "painPoints", "buyingIntent"],
        },
      },
    },
    required: ["suggestions"],
  },
};

export async function getAudienceSuggestions(businessId: string): Promise<AudienceSuggestion[]> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error("Business not found");

  // No live model → NO hardcoded segments. Return empty so the UI shows a "run research / connect a
  // model to get audience suggestions" state rather than fabricated segments with invented reach
  // numbers ("1M–3M on Meta") that look like real, business-specific recommendations.
  if (!llm) return [];

  const result = await runStructured<{ suggestions: AudienceSuggestion[] }>({
    maxTokens: 2048,
    tool: AUDIENCE_SUGGESTION_TOOL,
    messages: [
      {
        role: "user",
        content: `Generate 5 specific, actionable audience segments for this business:
Name: ${business.name}
Industry: ${business.industry}
Goals: ${business.goals.join(", ")}
Target Audience: ${business.targetAudience ?? "Not specified"}

Include a mix of cold, warm, and retargeting audiences. Make estimatedReach realistic.`,
      },
    ],
  });
  return result?.suggestions ?? [];
}
