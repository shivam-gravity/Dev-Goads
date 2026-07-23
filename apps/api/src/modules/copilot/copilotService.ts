import { llm, runText } from "../../infra/llmClient.js";
import { getBusiness } from "../business/businessService.js";
import { listCampaignsForBusiness } from "../orchestrator/campaignOrchestrator.js";
import { getAnalyticsSummary } from "../analytics/analyticsService.js";
import { normalizePerformance } from "../pipeline/performancePipeline.js";

export interface CopilotChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Strips stray non-Latin script characters that the free-tier models occasionally inject mid-word
 * (observed: "Total하원자 Spend" — Hangul spliced into an English label). We only run copilot in
 * English, so any CJK/Hangul/Hiragana/Katakana/Cyrillic/Arabic/Devanagari run is model noise, not
 * real content — remove it, then collapse any doubled space it leaves behind. Latin text,
 * punctuation, numbers, currency symbols, and emoji are untouched.
 */
function sanitizeReply(text: string): string {
  return text
    .replace(/[Ѐ-ӿ؀-ۿऀ-ॿ぀-ヿ㐀-䶿一-鿿가-힯]+/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ ([.,;:%×)])/g, "$1")
    .trim();
}

async function campaignSnapshots(campaigns: Awaited<ReturnType<typeof listCampaignsForBusiness>>) {
  return Promise.all(
    campaigns.map(async (c) => {
      const perf = await normalizePerformance(c.id);
      const impressions = perf.reduce((sum, p) => sum + p.impressions, 0);
      const clicks = perf.reduce((sum, p) => sum + p.clicks, 0);
      const conversions = perf.reduce((sum, p) => sum + p.conversions, 0);
      const revenueCents = perf.reduce((sum, p) => sum + p.revenueCents, 0);
      const spendCents = c.dailyBudgetCents; // daily rate; total spend isn't tracked per-campaign here
      const ctr = impressions > 0 ? clicks / impressions : null;
      // True ROAS: real reported revenue / spend (spend here is the daily budget rate — see above).
      const roas = revenueCents > 0 && spendCents > 0 ? revenueCents / spendCents : null;
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

  return `You are the CRM Ads Copilot, an AI assistant embedded across the CRM Ads dashboard that helps the user understand and improve their ad account. You can: analyze spend/ROAS/CTR, flag underperforming campaigns, draft ad copy and headlines, and suggest budget or pause/scale changes.

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

  if (!llm) return fallbackReply(business, campaigns.length);

  const text = await runText({
    maxTokens: 1024,
    system: await buildSystemPrompt(businessId),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return text ? sanitizeReply(text) : fallbackReply(business, campaigns.length);
}
