import type { AdAdapter, LaunchVariantInput, LaunchVariantResult, SetBudgetInput } from "./AdAdapter.js";
import { logger } from "../logger/logger.js";

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;
const hasLiveCredentials = Boolean(META_ACCESS_TOKEN && META_AD_ACCOUNT_ID);

function mockId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// Exponential Backoff Retry Helper
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 500): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      logger.info(`Sending Request: ${options.method || "GET"} ${url} (Attempt ${i + 1}/${retries})`);
      const res = await fetch(url, options);
      if (res.ok) {
        return res;
      }
      logger.warn(`Meta Ads API returned status ${res.status}. Attempt ${i + 1} failed.`);
      if (i === retries - 1) {
        throw new Error(`Meta API returned ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      logger.error(`Network Exception on Meta Ads fetch attempt ${i + 1}`, err);
      if (i === retries - 1) throw err;
    }
    await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
  }
  throw new Error("Meta Ads HTTP request failed after maximum retries");
}

export const metaAdapter: AdAdapter = {
  network: "meta",

  async launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult> {
    logger.info(`Initializing launchVariant on Meta Marketing network for campaign: ${input.campaignId}`);
    
    if (!hasLiveCredentials) {
      logger.info("Credentials absent. Falling back to Meta Ads mock placement.");
      return { externalId: mockId("meta_ad"), status: "active" };
    }

    try {
      const url = `https://graph.facebook.com/v19.0/act_${META_AD_ACCOUNT_ID}/ads?access_token=${META_ACCESS_TOKEN}`;
      const res = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${input.campaignId}-${input.variantId}`,
          status: "ACTIVE",
          creative: input.creative,
        }),
      });

      const json = (await res.json()) as any;
      
      // Response validation
      if (!json || !json.id) {
        throw new Error("Malformed Meta Marketing API response payload. Missing 'id' parameter.");
      }

      logger.info(`Meta Marketing ad campaign variant placed successfully: ${json.id}`);
      return { externalId: json.id, status: "active" };
    } catch (err) {
      logger.error("Failed to launch campaign variant on Meta Marketing Ads API", err);
      throw err;
    }
  },

  async pauseVariant(externalId: string): Promise<void> {
    logger.info(`Initializing pauseVariant on Meta for resource: ${externalId}`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock pausing Meta ad variant.");
      return;
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${externalId}?access_token=${META_ACCESS_TOKEN}`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAUSED" }),
      });
      logger.info(`Meta ad variant paused successfully: ${externalId}`);
    } catch (err) {
      logger.error("Failed to pause Meta campaign ad variant", err);
      throw err;
    }
  },

  async setBudget(input: SetBudgetInput): Promise<void> {
    logger.info(`Updating daily budget for Meta Ads resource: ${input.externalId} to ${input.dailyBudgetCents} cents`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock budget change complete.");
      return;
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${input.externalId}?access_token=${META_ACCESS_TOKEN}`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_budget: input.dailyBudgetCents }),
      });
      logger.info("Meta daily campaign budget successfully modified.");
    } catch (err) {
      logger.error("Failed to modify daily budget on Meta Ads API", err);
      throw err;
    }
  },

  async fetchInsights(externalId: string) {
    logger.info(`Fetching performance insights for Meta Ads resource: ${externalId}`);
    
    if (!hasLiveCredentials) {
      const impressions = Math.floor(2000 + Math.random() * 8000);
      const clicks = Math.floor(impressions * (0.01 + Math.random() * 0.04));
      const conversions = Math.floor(clicks * (0.02 + Math.random() * 0.08));
      const spendCents = Math.floor(clicks * (30 + Math.random() * 70));
      logger.info(`Offline mode. Generated mock insights metrics for ${externalId}`);
      return { impressions, clicks, conversions, spendCents };
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${externalId}/insights?fields=impressions,clicks,actions,spend&access_token=${META_ACCESS_TOKEN}`;
      const res = await fetchWithRetry(url, { method: "GET" });
      const json = (await res.json()) as any;
      
      // Response validation
      if (!json || !json.data) {
        logger.warn(`No stats returned in data array for Meta Ads resource: ${externalId}. Returning zero metrics.`);
        return { impressions: 0, clicks: 0, conversions: 0, spendCents: 0 };
      }

      const row = json.data[0] || {};
      const conversions = (row.actions || []).find((a: any) => a.action_type === "offsite_conversion")?.value ?? 0;
      
      const stats = {
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: Number(conversions),
        spendCents: Math.round(Number(row.spend ?? 0) * 100),
      };
      
      logger.info(`Meta Ads insights fetched: Clicks: ${stats.clicks}, Spend: ${stats.spendCents} cents`);
      return stats;
    } catch (err) {
      logger.error("Failed to query Meta Marketing campaign performance metrics", err);
      throw err;
    }
  },
};
