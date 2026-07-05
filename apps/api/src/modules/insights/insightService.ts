import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../db/prisma.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { normalizePerformance } from "../pipeline/performancePipeline.js";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export interface Insight {
  id: string;
  workspaceId: string;
  type: "anomaly" | "recommendation" | "trend" | "opportunity";
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

const DEMO_INSIGHTS: Omit<Insight, "id" | "workspaceId" | "dismissed" | "createdAt">[] = [
  { type: "anomaly", title: "CTR dropped 23% in last 24h", description: "Your Meta campaign 'Brand Awareness Q3' experienced a significant click-through rate decline. This often signals creative fatigue — your audience has seen the same ad too many times.", metric: "CTR", change: -23, severity: "high", actionLabel: "Refresh Creatives", actionUrl: "/creatives" },
  { type: "opportunity", title: "High-intent audience underserved", description: "AI detected a 'Tech professionals 28-35' segment converting at 3.2× your baseline but receiving only 8% of your budget allocation. Shifting budget could yield significant ROAS improvement.", metric: "ROAS", change: 220, severity: "high", actionLabel: "Adjust Audiences", actionUrl: "/audiences" },
  { type: "recommendation", title: "Increase Google budget by 15%", description: "Google Ads is delivering $4.2 ROAS vs Meta's $2.1. Your daily cap is limiting impressions during peak hours (7-9pm). A 15% budget increase could unlock an estimated 34% more conversions.", metric: "Budget", change: 15, severity: "medium", actionLabel: "Adjust Budget", actionUrl: "/campaigns" },
  { type: "trend", title: "Weekend performance 40% higher", description: "Your ads consistently perform 40% better on weekends (Sat-Sun). Consider scheduling higher bids and budgets during these periods using dayparting.", metric: "Conversions", change: 40, severity: "medium", actionLabel: "View Analytics", actionUrl: "/analytics" },
  { type: "recommendation", title: "3 variants ready to pause", description: "Based on 500+ impressions each, 3 ad variants have CTR below 0.5% and CPA 3× your target. Pausing them would free up budget for your top 2 performers.", metric: "CPA", change: -35, severity: "medium", actionLabel: "Review Variants", actionUrl: "/campaigns" },
  { type: "opportunity", title: "Competitor analysis: gap in search", description: "AI detected low competition for 5 high-intent keywords in your category. These keywords have avg CPC 40% below your current spend with similar conversion intent.", metric: "CPC", change: -40, severity: "low", actionLabel: "View Keywords", actionUrl: "/campaigns" },
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
    const i: Insight = { id: randomUUID(), workspaceId, dismissed: false, createdAt: new Date().toISOString(), ...d };
    await save(i);
  }
}

export async function listInsights(workspaceId: string): Promise<Insight[]> {
  const rows = await prisma.insight.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as Insight);
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
            title: { type: "string" },
            description: { type: "string" },
            metric: { type: "string" },
            change: { type: "number" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            actionLabel: { type: "string" },
            actionUrl: { type: "string" },
          },
          required: ["type", "title", "description", "severity"],
        },
      },
    },
    required: ["insights"],
  },
};

export async function generateInsights(workspaceId: string, businessId: string): Promise<Insight[]> {
  if (!anthropic) {
    await seedDemoInsights(workspaceId);
    return listInsights(workspaceId);
  }

  const campaigns = await listCampaignsForBusiness(businessId);
  const perfData = (await Promise.all(campaigns.map((c) => normalizePerformance(c.id)))).flat();

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    tools: [INSIGHT_TOOL],
    tool_choice: { type: "tool", name: "emit_insights" },
    messages: [{ role: "user", content: `Analyze this campaign performance data and generate actionable insights:\n${JSON.stringify(perfData, null, 2)}\n\nFocus on anomalies, optimization opportunities, and budget recommendations.` }],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) { await seedDemoInsights(workspaceId); return listInsights(workspaceId); }

  const result = toolUse.input as { insights: Omit<Insight, "id" | "workspaceId" | "dismissed" | "createdAt">[] };
  const created: Insight[] = [];
  for (const d of result.insights) {
    const i: Insight = { id: randomUUID(), workspaceId, dismissed: false, createdAt: new Date().toISOString(), ...d };
    await save(i);
    created.push(i);
  }
  return created;
}
