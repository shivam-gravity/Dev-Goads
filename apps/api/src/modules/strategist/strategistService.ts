import { openai, runText } from "../../infra/openaiClient.js";
import { getBusiness } from "../business/businessService.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { getAnalyticsSummary } from "../analytics/analyticsService.js";

export interface StrategistChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function buildSystemPrompt(businessId: string): Promise<string> {
  const business = await getBusiness(businessId);
  const campaigns = await listCampaignsForBusiness(businessId);
  const summary = await getAnalyticsSummary(businessId, "all");

  const context = {
    business: business
      ? { name: business.name, industry: business.industry, monthlyBudgetCents: business.monthlyBudgetCents, goals: business.goals }
      : null,
    campaigns: campaigns.map((c) => ({ name: c.name, status: c.status, networks: c.networks, dailyBudgetCents: c.dailyBudgetCents })),
    performance: summary,
  };

  return `You are the Polluxa Strategist, an expert media-buying assistant embedded in the "Media Plan" section of a paid-ads platform. You help the user generate, revise, and evaluate their media plan, and can set long-term brand preferences on request.

Speak concisely and concretely, referencing real numbers from the account data below when relevant. If the account has no active campaigns yet, say so and guide the user toward launching their first campaign rather than inventing data.

Current account context:
${JSON.stringify(context, null, 2)}`;
}

function fallbackReply(business: { name: string } | null, campaignCount: number): string {
  if (campaignCount === 0) {
    return `I don't have any live campaign data for ${business?.name ?? "this business"} yet. Once you launch your first campaign, I'll be able to analyze performance and help you build out a media plan — for now I can help you think through targeting, budget split, or creative angles.`;
  }
  return `I can see ${campaignCount} campaign(s) on ${business?.name ?? "this account"}. Ask me about performance, budget shifts, or what to test next and I'll dig into the numbers.`;
}

export async function chatWithStrategist(businessId: string, messages: StrategistChatMessage[]): Promise<string> {
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
