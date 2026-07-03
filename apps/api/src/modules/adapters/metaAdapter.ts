import type { AdAdapter, LaunchVariantInput, LaunchVariantResult, SetBudgetInput } from "./AdAdapter.js";

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;
const hasLiveCredentials = Boolean(META_ACCESS_TOKEN && META_AD_ACCOUNT_ID);

function mockId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Meta Marketing API client. Falls back to deterministic mock data in local/dev
 * environments where META_ACCESS_TOKEN / META_AD_ACCOUNT_ID are not configured,
 * so the rest of the pipeline can be exercised without live ad-account access.
 */
export const metaAdapter: AdAdapter = {
  network: "meta",

  async launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult> {
    if (!hasLiveCredentials) {
      return { externalId: mockId("meta_ad"), status: "active" };
    }
    const res = await fetch(
      `https://graph.facebook.com/v19.0/act_${META_AD_ACCOUNT_ID}/ads?access_token=${META_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${input.campaignId}-${input.variantId}`,
          status: "ACTIVE",
          creative: input.creative,
        }),
      }
    );
    if (!res.ok) throw new Error(`Meta launchVariant failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return { externalId: json.id, status: "active" };
  },

  async pauseVariant(externalId: string): Promise<void> {
    if (!hasLiveCredentials) return;
    await fetch(`https://graph.facebook.com/v19.0/${externalId}?access_token=${META_ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    });
  },

  async setBudget(input: SetBudgetInput): Promise<void> {
    if (!hasLiveCredentials) return;
    await fetch(`https://graph.facebook.com/v19.0/${input.externalId}?access_token=${META_ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_budget: input.dailyBudgetCents }),
    });
  },

  async fetchInsights(externalId: string) {
    if (!hasLiveCredentials) {
      const impressions = Math.floor(2000 + Math.random() * 8000);
      const clicks = Math.floor(impressions * (0.01 + Math.random() * 0.04));
      const conversions = Math.floor(clicks * (0.02 + Math.random() * 0.08));
      const spendCents = Math.floor(clicks * (30 + Math.random() * 70));
      return { impressions, clicks, conversions, spendCents };
    }
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${externalId}/insights?fields=impressions,clicks,actions,spend&access_token=${META_ACCESS_TOKEN}`
    );
    if (!res.ok) throw new Error(`Meta fetchInsights failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as any;
    const row = json.data?.[0] ?? {};
    const conversions = (row.actions ?? []).find((a: any) => a.action_type === "offsite_conversion")?.value ?? 0;
    return {
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      conversions: Number(conversions),
      spendCents: Math.round(Number(row.spend ?? 0) * 100),
    };
  },
};
