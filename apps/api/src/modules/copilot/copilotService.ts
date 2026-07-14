import { openai, runText } from "../../infra/openaiClient.js";
import { getBusiness } from "../business/businessService.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { getAnalyticsSummary } from "../analytics/analyticsService.js";
import { normalizePerformance } from "../pipeline/performancePipeline.js";
import { ESTIMATED_REVENUE_CENTS_PER_CONVERSION } from "../pipeline/performancePipeline.js";

export interface CopilotChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function campaignSnapshots(campaigns: Awaited<ReturnType<typeof listCampaignsForBusiness>>) {
  return Promise.all(
    campaigns.map(async (c) => {
      const perf = await normalizePerformance(c.id);
      const impressions = perf.reduce((sum, p) => sum + p.impressions, 0);
      const clicks = perf.reduce((sum, p) => sum + p.clicks, 0);
      const conversions = perf.reduce((sum, p) => sum + p.conversions, 0);
      const spendCents = c.dailyBudgetCents; // daily rate; total spend isn't tracked per-campaign here
      const ctr = impressions > 0 ? clicks / impressions : null;
      const roas = conversions > 0 && spendCents > 0 ? (conversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / spendCents : null;
      return {
        name: c.name,
        status: c.status,
        networks: c.networks,
        dailyBudgetCents: c.dailyBudgetCents,
        impressions,
        clicks,
        conversions,
        ctr,
        roas,
      };
    }),
  );
}

async function buildSystemPrompt(businessId: string): Promise<string> {
  const business = await getBusiness(businessId);
  const campaigns = await listCampaignsForBusiness(businessId);
  const summary = await getAnalyticsSummary(businessId, "all");
  const perCampaign = await campaignSnapshots(campaigns);

  const context = {
    business: business
      ? { name: business.name, industry: business.industry, monthlyBudgetCents: business.monthlyBudgetCents, goals: business.goals }
      : null,
    accountSummary: summary,
    campaigns: perCampaign,
  };

  return `You are the CRM Ads Copilot, an AI assistant embedded across the Polluxa dashboard that helps the user understand and improve their ad account. You can: analyze spend/ROAS/CTR, flag underperforming campaigns, draft ad copy and headlines, and suggest budget or pause/scale changes.

Ground every claim in the real account data below — never invent numbers. If a metric isn't in the data (e.g. no campaigns yet), say so plainly instead of guessing.

You cannot directly execute changes (you have no write access to campaigns). If the user asks you to make a change, give a specific, concrete recommendation and tell them to apply it via the Campaign Builder or Drafts — don't claim you've "submitted" or "prepared" anything on their behalf.

Speak concisely, like a sharp media buyer, not a generic assistant. Use real numbers from the data below wherever relevant.

Current account data:
${JSON.stringify(context, null, 2)}`;
}

function fallbackReply(business: { name: string } | null, campaignCount: number): string {
  if (campaignCount === 0) {
    return `I don't have any live campaigns for ${business?.name ?? "this account"} yet, so I can't analyze performance. Once you launch a campaign, ask me again and I'll dig into spend, ROAS, and what to test next.`;
  }
  return `I can see ${campaignCount} campaign(s) on ${business?.name ?? "this account"}. Ask me about budget, underperforming ads, or headline ideas and I'll ground the answer in your real numbers.`;
}

export async function chatWithCopilot(businessId: string, messages: CopilotChatMessage[]): Promise<string> {
  const business = await getBusiness(businessId);
  const campaigns = await listCampaignsForBusiness(businessId);

  if (!openai) return fallbackReply(business, campaigns.length);

  const text = await runText({
    maxTokens: 1024,
    system: await buildSystemPrompt(businessId),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return text ?? fallbackReply(business, campaigns.length);
}
