import type { AdAdapter, LaunchVariantInput, LaunchVariantResult, SetBudgetInput } from "./AdAdapter.js";
import { logger } from "../logger/logger.js";

const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const TIKTOK_ADVERTISER_ID = process.env.TIKTOK_ADVERTISER_ID;
const hasLiveCredentials = Boolean(TIKTOK_ACCESS_TOKEN && TIKTOK_ADVERTISER_ID);

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
      logger.warn(`TikTok Ads API returned status ${res.status}. Attempt ${i + 1} failed.`);
      if (i === retries - 1) {
        throw new Error(`TikTok API returned ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      logger.error(`Network Exception on TikTok Ads fetch attempt ${i + 1}`, err);
      if (i === retries - 1) throw err;
    }
    await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
  }
  throw new Error("TikTok Ads HTTP request failed after maximum retries");
}

export const tiktokAdapter: AdAdapter = {
  network: "tiktok",

  async launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult> {
    logger.info(`Initializing launchVariant on TikTok Ads network for campaign: ${input.campaignId}`);

    if (!hasLiveCredentials) {
      logger.info("Credentials absent. Falling back to TikTok Ads mock placement.");
      return { externalId: mockId("tiktok_ad"), status: "active" };
    }

    try {
      const url = "https://business-api.tiktok.com/open_api/v1.3/ad/create/";
      const res = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": TIKTOK_ACCESS_TOKEN!,
        },
        body: JSON.stringify({
          advertiser_id: TIKTOK_ADVERTISER_ID,
          ad_name: `${input.campaignId}-${input.variantId}`,
          ad_text: input.creative.body,
          call_to_action: input.creative.callToAction,
          budget: input.dailyBudgetCents / 100,
        }),
      });

      const json = (await res.json()) as any;

      const adId = json?.data?.ad_ids?.[0];
      if (!adId) {
        throw new Error("Malformed TikTok Ads API response payload. Missing data.ad_ids array.");
      }

      logger.info(`TikTok ad placed successfully: ${adId}`);
      return { externalId: adId, status: "active" };
    } catch (err) {
      logger.error("Failed to launch campaign variant on TikTok Ads API", err);
      throw err;
    }
  },

  async pauseVariant(externalId: string): Promise<void> {
    logger.info(`Initializing pauseVariant on TikTok for resource: ${externalId}`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock pausing TikTok ad variant.");
      return;
    }

    try {
      const url = "https://business-api.tiktok.com/open_api/v1.3/ad/status/update/";
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": TIKTOK_ACCESS_TOKEN!,
        },
        body: JSON.stringify({ advertiser_id: TIKTOK_ADVERTISER_ID, ad_ids: [externalId], status: "DISABLE" }),
      });
      logger.info(`TikTok ad variant paused successfully: ${externalId}`);
    } catch (err) {
      logger.error("Failed to pause TikTok campaign ad variant", err);
      throw err;
    }
  },

  async activateVariant(externalId: string): Promise<void> {
    logger.info(`Initializing activateVariant on TikTok for resource: ${externalId}`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock activating TikTok ad variant.");
      return;
    }

    try {
      const url = "https://business-api.tiktok.com/open_api/v1.3/ad/status/update/";
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": TIKTOK_ACCESS_TOKEN!,
        },
        body: JSON.stringify({ advertiser_id: TIKTOK_ADVERTISER_ID, ad_ids: [externalId], status: "ENABLE" }),
      });
      logger.info(`TikTok ad variant activated successfully: ${externalId}`);
    } catch (err) {
      logger.error("Failed to activate TikTok campaign ad variant", err);
      throw err;
    }
  },

  async setBudget(input: SetBudgetInput): Promise<void> {
    logger.info(`Updating daily budget for TikTok Ads resource: ${input.externalId} to ${input.dailyBudgetCents} cents`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock budget change complete.");
      return;
    }

    try {
      const url = "https://business-api.tiktok.com/open_api/v1.3/ad/update/";
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": TIKTOK_ACCESS_TOKEN!,
        },
        body: JSON.stringify({ advertiser_id: TIKTOK_ADVERTISER_ID, ad_id: input.externalId, budget: input.dailyBudgetCents / 100 }),
      });
      logger.info("TikTok Ads campaign budget mutation successfully applied.");
    } catch (err) {
      logger.error("Failed to modify campaign budget on TikTok Ads API", err);
      throw err;
    }
  },

  async fetchInsights(externalId: string) {
    logger.info(`Fetching performance insights for TikTok Ads resource: ${externalId}`);

    if (!hasLiveCredentials) {
      const impressions = Math.floor(1800 + Math.random() * 9500);
      const reach = Math.floor(impressions * (0.55 + Math.random() * 0.3));
      const clicks = Math.floor(impressions * (0.02 + Math.random() * 0.04));
      const conversions = Math.floor(clicks * (0.02 + Math.random() * 0.06));
      const spendCents = Math.floor(clicks * (25 + Math.random() * 65));
      logger.info(`Offline mode. Generated mock insights metrics for ${externalId}`);
      return { impressions, reach, clicks, conversions, spendCents };
    }

    try {
      const url = "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/";
      const res = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": TIKTOK_ACCESS_TOKEN!,
        },
        body: JSON.stringify({
          advertiser_id: TIKTOK_ADVERTISER_ID,
          dimensions: ["ad_id"],
          metrics: ["impressions", "reach", "clicks", "conversions", "spend"],
          filters: [{ field_name: "ad_id", filter_type: "IN", filter_value: JSON.stringify([externalId]) }],
        }),
      });

      const json = (await res.json()) as any;
      const row = json?.data?.list?.[0]?.metrics;

      if (!row) {
        logger.warn(`No metrics returned for TikTok Ads resource: ${externalId}. Returning zero metrics.`);
        return { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0 };
      }

      const stats = {
        impressions: Number(row.impressions ?? 0),
        reach: Number(row.reach ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: Number(row.conversions ?? 0),
        spendCents: Math.round(Number(row.spend ?? 0) * 100),
      };
      logger.info(`TikTok Ads insights fetched: Clicks: ${stats.clicks}, Spend: ${stats.spendCents} cents`);
      return stats;
    } catch (err) {
      logger.error("Failed to query TikTok Ads performance statistics", err);
      throw err;
    }
  },
};
