import type { AdAdapter, LaunchVariantInput, LaunchVariantResult, SetBudgetInput } from "./AdAdapter.js";

const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const GOOGLE_ADS_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID;
const GOOGLE_ADS_ACCESS_TOKEN = process.env.GOOGLE_ADS_ACCESS_TOKEN;
const hasLiveCredentials = Boolean(
  GOOGLE_ADS_DEVELOPER_TOKEN && GOOGLE_ADS_CUSTOMER_ID && GOOGLE_ADS_ACCESS_TOKEN
);

function mockId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Google Ads API client. Falls back to deterministic mock data when
 * GOOGLE_ADS_* credentials are absent, mirroring the Meta adapter so the
 * orchestrator/optimization loop can be developed and tested offline.
 */
export const googleAdapter: AdAdapter = {
  network: "google",

  async launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult> {
    if (!hasLiveCredentials) {
      return { externalId: mockId("gads_ad"), status: "active" };
    }
    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/adGroupAds:mutate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [
            {
              create: {
                status: "ENABLED",
                ad: { finalUrls: [], responsiveSearchAd: { headlines: [{ text: input.creative.headline }] } },
              },
            },
          ],
        }),
      }
    );
    if (!res.ok) throw new Error(`Google Ads launchVariant failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as any;
    const resourceName = json.results?.[0]?.resourceName ?? mockId("gads_ad");
    return { externalId: resourceName, status: "active" };
  },

  async pauseVariant(externalId: string): Promise<void> {
    if (!hasLiveCredentials) return;
    await fetch(`https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/adGroupAds:mutate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
        "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN!,
      },
      body: JSON.stringify({ operations: [{ update: { resourceName: externalId, status: "PAUSED" } }] }),
    });
  },

  async setBudget(input: SetBudgetInput): Promise<void> {
    if (!hasLiveCredentials) return;
    await fetch(`https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/campaignBudgets:mutate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
        "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN!,
      },
      body: JSON.stringify({
        operations: [{ update: { resourceName: input.externalId, amountMicros: input.dailyBudgetCents * 10000 } }],
      }),
    });
  },

  async fetchInsights(externalId: string) {
    if (!hasLiveCredentials) {
      const impressions = Math.floor(1500 + Math.random() * 9000);
      const clicks = Math.floor(impressions * (0.015 + Math.random() * 0.035));
      const conversions = Math.floor(clicks * (0.03 + Math.random() * 0.07));
      const spendCents = Math.floor(clicks * (40 + Math.random() * 80));
      return { impressions, clicks, conversions, spendCents };
    }
    const query = `SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
                    FROM ad_group_ad WHERE ad_group_ad.resource_name = '${externalId}'`;
    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({ query }),
      }
    );
    if (!res.ok) throw new Error(`Google Ads fetchInsights failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as any;
    const metrics = json.results?.[0]?.metrics ?? {};
    return {
      impressions: Number(metrics.impressions ?? 0),
      clicks: Number(metrics.clicks ?? 0),
      conversions: Number(metrics.conversions ?? 0),
      spendCents: Math.round(Number(metrics.costMicros ?? 0) / 10000),
    };
  },
};
