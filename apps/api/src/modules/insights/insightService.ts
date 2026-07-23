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

async function save(i: Insight): Promise<void> {
  await prisma.insight.upsert({
    where: { id: i.id },
    create: { id: i.id, workspaceId: i.workspaceId, data: i as any, createdAt: new Date(i.createdAt) },
    update: { data: i as any },
  });
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

  // No live model → NO fabricated insights. Return whatever real (optimizer-written) insights
  // exist; the AIInsights feed shows its "no insights yet — connect a model / run a campaign"
  // empty state rather than hardcoded demo insights ("CTR dropped 23%", fake "Brand Awareness Q3").
  if (!llm) return listInsights(workspaceId);

  const campaigns = await listCampaignsForBusiness(businessId);
  const perfData = (await Promise.all(campaigns.map((c) => normalizePerformance(c.id)))).flat();

  const campaignSummary = campaigns.map((c) => ({
    name: c.name, networks: c.networks, dailyBudgetCents: c.dailyBudgetCents, variantCount: c.variants.length,
    audiences: [...new Set(c.variants.map((v) => v.audienceName).filter(Boolean))],
    platforms: [...new Set(c.variants.map((v) => v.network))],
  }));

  const dataToAnalyze = perfData.length > 0 ? perfData : campaignSummary;

  const result = await runStructured<{ insights: Omit<Insight, "id" | "workspaceId" | "dismissed" | "createdAt" | "source">[] }>({
    maxTokens: 1024,
    tool: INSIGHT_TOOL,
    messages: [{ role: "user", content: `Analyze this campaign data and generate actionable insights and recommendations:\n${JSON.stringify(dataToAnalyze, null, 2)}\n\nCover a mix of categories where the data supports it: budget (spend/allocation), audience (targeting/segments), creative (ad copy/asset fatigue), and placement (which networks/surfaces are under- or over-performing) — don't default every insight to budget. If no performance metrics exist yet, base insights on campaign structure, budget allocation, audience diversity, and network coverage.` }],
  });
  // Model produced nothing usable → return real insights only, no fabricated fallback.
  if (!result) return listInsights(workspaceId);

  for (const d of result.insights) {
    const i: Insight = { id: randomUUID(), workspaceId, source: "ai_generated", dismissed: false, createdAt: new Date().toISOString(), ...d };
    await save(i);
  }
  return listInsights(workspaceId);
}
