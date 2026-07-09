import { openai, runStructured } from "../../infra/openaiClient.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { normalizePerformance, getRawMetrics, ESTIMATED_REVENUE_CENTS_PER_CONVERSION } from "../pipeline/performancePipeline.js";
import { getBusiness } from "../business/businessService.js";
import type { AnalyticsSummary, TrendPoint, AudienceSuggestion, AdNetwork } from "../../types/index.js";

export async function getAnalyticsSummary(businessId: string, period: "all" | "month" | "week" = "all"): Promise<AnalyticsSummary> {
  const campaigns = await listCampaignsForBusiness(businessId);
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;

  let totalSpendCents = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalConversions = 0;

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
      }
    } else {
      const perf = await normalizePerformance(campaign.id);
      for (const p of perf) {
        totalSpendCents += p.spendCents;
        totalImpressions += p.impressions;
        totalClicks += p.clicks;
        totalConversions += p.conversions;
      }
    }
  }

  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgCpc = totalClicks > 0 ? totalSpendCents / totalClicks : null;
  const roas = totalSpendCents > 0 && totalConversions > 0 ? (totalConversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / totalSpendCents : null;

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

  // Group by date
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
    points.push({
      date,
      impressions,
      clicks,
      conversions,
      spendCents,
      ctr: impressions > 0 ? clicks / impressions : 0,
    });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
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

function fallbackAudienceSuggestions(businessName: string, industry: string): AudienceSuggestion[] {
  return [
    {
      name: "Core Decision Makers",
      description: `Primary buyers in the ${industry} space who actively evaluate solutions like ${businessName}.`,
      estimatedReach: "1M–3M on Meta",
      platforms: ["meta", "google"] as AdNetwork[],
      interests: [industry, "business software", "productivity"],
      demographics: "Ages 28–45, managers and above",
      painPoints: ["Time wasted on manual processes", "Difficulty scaling", "High operational costs"],
      buyingIntent: "high",
    },
    {
      name: "In-Market Searchers",
      description: `People actively searching Google for ${industry} solutions or alternatives.`,
      estimatedReach: "500K–2M on Google",
      platforms: ["google"] as AdNetwork[],
      interests: ["solution comparison", "reviews", "pricing"],
      demographics: "All ages, purchase-intent behavior",
      painPoints: ["Unsatisfied with current solution", "Need specific feature"],
      buyingIntent: "high",
    },
    {
      name: "Social Media Professionals",
      description: "Career-driven professionals active on LinkedIn-equivalent networks who discover tools via social.",
      estimatedReach: "2M–8M on Meta",
      platforms: ["meta"] as AdNetwork[],
      interests: ["professional development", "networking", "industry news"],
      demographics: "Ages 25–40, college-educated",
      painPoints: ["Staying competitive", "Learning new skills"],
      buyingIntent: "medium",
    },
    {
      name: "Lookalike — Current Customers",
      description: "Audiences similar to your existing customers based on behavioral and demographic signals.",
      estimatedReach: "3M–10M on Meta",
      platforms: ["meta"] as AdNetwork[],
      interests: ["similar to your best customers"],
      demographics: "Mirrors your current customer base",
      painPoints: ["Same pain points as your customers"],
      buyingIntent: "medium",
    },
    {
      name: "Retargeting — Site Visitors (30d)",
      description: "Warm audience: people who already visited your website in the last 30 days.",
      estimatedReach: "Depends on traffic volume",
      platforms: ["meta", "google"] as AdNetwork[],
      interests: ["already aware of your brand"],
      demographics: "All visitors",
      painPoints: ["Still evaluating options", "Need a nudge to convert"],
      buyingIntent: "high",
    },
  ];
}

export async function getAudienceSuggestions(businessId: string): Promise<AudienceSuggestion[]> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error("Business not found");

  if (!openai) return fallbackAudienceSuggestions(business.name, business.industry);

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
  if (!result) return fallbackAudienceSuggestions(business.name, business.industry);
  return result.suggestions;
}
