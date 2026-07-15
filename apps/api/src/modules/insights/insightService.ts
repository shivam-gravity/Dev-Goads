import { randomUUID } from "node:crypto";
import { llm, runStructured } from "../../infra/llmClient.js";
import { prisma } from "../../db/prisma.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { normalizePerformance } from "../pipeline/performancePipeline.js";
import type { OptimizationDecision } from "../../types/index.js";

export interface Insight {
  id: string;
  workspaceId: string;
  type: "anomaly" | "recommendation" | "trend" | "opportunity";
  /** Which lever this suggestion pulls — lets the UI filter/group budget vs. audience vs. creative vs. placement recommendations, and lets runOptimizationPass's decisions (always "budget") land in the same feed as the free-text Claude-generated ones. */
  category: "budget" | "audience" | "creative" | "placement";
  /** "ai_generated" batches are a point-in-time snapshot superseded wholesale by the next generateInsights call; "optimizer" entries are a permanent action log written by recordOptimizationInsights and are never auto-cleared. */
  source: "ai_generated" | "optimizer";
  title: string;
  description: string;
  metric?: string;
  change?: number;
  severity: "low" | "medium" | "high";
  actionLabel?: string;
  actionUrl?: string;
  dismissed: boolean;
  createdAt: string;
}

const DEMO_INSIGHTS: Omit<Insight, "id" | "workspaceId" | "dismissed" | "createdAt" | "source">[] = [
  { type: "anomaly", category: "creative", title: "CTR dropped 23% in last 24h", description: "Your Meta campaign 'Brand Awareness Q3' experienced a significant click-through rate decline. This often signals creative fatigue — your audience has seen the same ad too many times.", metric: "CTR", change: -23, severity: "high", actionLabel: "Refresh Creatives", actionUrl: "/creatives" },
  { type: "opportunity", category: "audience", title: "High-intent audience underserved", description: "AI detected a 'Tech professionals 28-35' segment converting at 3.2× your baseline but receiving only 8% of your budget allocation. Shifting budget could yield significant ROAS improvement.", metric: "ROAS", change: 220, severity: "high", actionLabel: "Adjust Audiences", actionUrl: "/audiences" },
  { type: "recommendation", category: "budget", title: "Increase Google budget by 15%", description: "Google Ads is delivering $4.2 ROAS vs Meta's $2.1. Your daily cap is limiting impressions during peak hours (7-9pm). A 15% budget increase could unlock an estimated 34% more conversions.", metric: "Budget", change: 15, severity: "medium", actionLabel: "Adjust Budget", actionUrl: "/campaigns" },
  { type: "opportunity", category: "placement", title: "Audience Network placement underperforming", description: "Ads shown on Meta's Audience Network (off-platform partner sites) have 3× the CPA of your Feed and Stories placements combined. Excluding this placement would reallocate spend to your stronger channels.", metric: "CPA", change: -60, severity: "medium", actionLabel: "Review Placements", actionUrl: "/campaigns" },
  { type: "recommendation", category: "budget", title: "3 variants ready to pause", description: "Based on 500+ impressions each, 3 ad variants have CTR below 0.5% and CPA 3× your target. Pausing them would free up budget for your top 2 performers.", metric: "CPA", change: -35, severity: "medium", actionLabel: "Review Variants", actionUrl: "/campaigns" },
  { type: "opportunity", category: "audience", title: "Competitor analysis: gap in search", description: "AI detected low competition for 5 high-intent keywords in your category. These keywords have avg CPC 40% below your current spend with similar conversion intent.", metric: "CPC", change: -40, severity: "low", actionLabel: "View Keywords", actionUrl: "/campaigns" },
];

async function save(i: Insight): Promise<void> {
  await prisma.insight.upsert({
    where: { id: i.id },
    create: { id: i.id, workspaceId: i.workspaceId, data: i as any, createdAt: new Date(i.createdAt) },
    update: { data: i as any },
  });
}

export async function seedDemoInsights(workspaceId: string): Promise<void> {
  const existing = await listInsights(workspaceId);
  if (existing.length > 0) return;
  for (const d of DEMO_INSIGHTS) {
    const i: Insight = { id: randomUUID(), workspaceId, source: "ai_generated", dismissed: false, createdAt: new Date().toISOString(), ...d };
    await save(i);
  }
}

export async function listInsights(workspaceId: string): Promise<Insight[]> {
  const rows = await prisma.insight.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as Insight);
}

/** Wipes the prior ai_generated snapshot before a new one is written, so repeated refreshes
 * (button clicks, page revisits) show the latest analysis instead of piling up duplicates
 * indefinitely. Optimizer-written entries are a real action log and are left untouched. */
async function clearGeneratedInsights(workspaceId: string): Promise<void> {
  const existing = await listInsights(workspaceId);
  const staleIds = existing.filter((i) => i.source !== "optimizer").map((i) => i.id);
  if (staleIds.length) await prisma.insight.deleteMany({ where: { id: { in: staleIds } } });
}

/**
 * Converts runOptimizationPass's bandit decisions into persisted Insight records, so budget
 * reallocations/pauses the engine already performs actually show up in the same feed
 * AIInsights.tsx reads — previously these two systems never talked to each other. "hold"
 * decisions are deliberately skipped: "no change" isn't an actionable suggestion worth
 * surfacing. Called after both the manual /campaigns/:id/optimize trigger and the scheduled
 * metricsIngestionWorker pass.
 */
export async function recordOptimizationInsights(workspaceId: string, decisions: OptimizationDecision[]): Promise<Insight[]> {
  const created: Insight[] = [];
  for (const d of decisions) {
    if (d.action === "hold") continue;
    const isFatigueRefresh = d.action === "regenerate_creative";
    const i: Insight = {
      id: randomUUID(),
      workspaceId,
      type: d.action === "pause" ? "anomaly" : isFatigueRefresh ? "anomaly" : "recommendation",
      category: isFatigueRefresh ? "creative" : "budget",
      source: "optimizer",
      title: d.action === "pause"
        ? "Underperforming variant paused"
        : isFatigueRefresh
          ? "Creative fatigue detected — new variant generated"
          : d.action === "increase_budget"
            ? "Budget shifted to top performer"
            : "Budget trimmed on a lagging variant",
      description: d.reason,
      metric: isFatigueRefresh ? "Fatigue" : "Budget",
      severity: d.action === "pause" ? "medium" : isFatigueRefresh ? "medium" : "low",
      actionLabel: isFatigueRefresh ? "Review New Creative" : "View Campaign",
      actionUrl: isFatigueRefresh ? "/creatives" : `/campaigns/${d.campaignId}`,
      dismissed: false,
      createdAt: d.decidedAt,
    };
    await save(i);
    created.push(i);
  }
  return created;
}

export async function dismissInsight(id: string): Promise<Insight> {
  const row = await prisma.insight.findUnique({ where: { id } });
  if (!row) throw new Error("Insight not found");
  const i: Insight = { ...(row.data as unknown as Insight), dismissed: true };
  await save(i);
  return i;
}

const INSIGHT_TOOL = {
  name: "emit_insights",
  description: "Generate AI-powered performance insights for ad campaigns.",
  input_schema: {
    type: "object" as const,
    properties: {
      insights: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["anomaly", "recommendation", "trend", "opportunity"] },
            category: { type: "string", enum: ["budget", "audience", "creative", "placement"], description: "Which lever this suggestion pulls: budget (spend/allocation changes), audience (targeting/segment changes), creative (ad copy/asset changes), or placement (which surfaces/networks the ad shows on)." },
            title: { type: "string" },
            description: { type: "string" },
            metric: { type: "string" },
            change: { type: "number" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            actionLabel: { type: "string" },
            actionUrl: { type: "string" },
          },
          required: ["type", "category", "title", "description", "severity"],
        },
      },
    },
    required: ["insights"],
  },
};

export async function generateInsights(workspaceId: string, businessId: string): Promise<Insight[]> {
  await clearGeneratedInsights(workspaceId);

  if (!llm) {
    await seedDemoInsights(workspaceId);
    return listInsights(workspaceId);
  }

  const campaigns = await listCampaignsForBusiness(businessId);
  const perfData = (await Promise.all(campaigns.map((c) => normalizePerformance(c.id)))).flat();

  const result = await runStructured<{ insights: Omit<Insight, "id" | "workspaceId" | "dismissed" | "createdAt" | "source">[] }>({
    maxTokens: 1024,
    tool: INSIGHT_TOOL,
    messages: [{ role: "user", content: `Analyze this campaign performance data and generate actionable insights:\n${JSON.stringify(perfData, null, 2)}\n\nCover a mix of categories where the data supports it: budget (spend/allocation), audience (targeting/segments), creative (ad copy/asset fatigue), and placement (which networks/surfaces are under- or over-performing) — don't default every insight to budget.` }],
  });
  if (!result) { await seedDemoInsights(workspaceId); return listInsights(workspaceId); }

  for (const d of result.insights) {
    const i: Insight = { id: randomUUID(), workspaceId, source: "ai_generated", dismissed: false, createdAt: new Date().toISOString(), ...d };
    await save(i);
  }
  return listInsights(workspaceId);
}
