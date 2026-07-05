import type { AdAdapter, LaunchVariantInput, LaunchVariantResult, SetBudgetInput } from "./AdAdapter.js";
import { logger } from "../logger/logger.js";

const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const GOOGLE_ADS_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID;
const GOOGLE_ADS_ACCESS_TOKEN = process.env.GOOGLE_ADS_ACCESS_TOKEN;
const hasLiveCredentials = Boolean(
  GOOGLE_ADS_DEVELOPER_TOKEN && GOOGLE_ADS_CUSTOMER_ID && GOOGLE_ADS_ACCESS_TOKEN
);

function mockId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// Exponential Backoff Retry Helper
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 500): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      logger.info(`Sending Request: POST ${url} (Attempt ${i + 1}/${retries})`);
      const res = await fetch(url, options);
      if (res.ok) {
        return res;
      }
      logger.warn(`API server returned code ${res.status}. Attempt ${i + 1} failed.`);
      if (i === retries - 1) {
        throw new Error(`API returned ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      logger.error(`Network Exception on fetch attempt ${i + 1}`, err);
      if (i === retries - 1) throw err;
    }
    await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
  }
  throw new Error("HTTP request failed after maximum retries");
}

export const googleAdapter: AdAdapter = {
  network: "google",

  async launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult> {
    logger.info(`Initializing launchVariant on Google Ads network for campaign: ${input.campaignId}`);
    
    if (!hasLiveCredentials) {
      logger.info("Credentials absent. Falling back to Google Ads mock ad placement.");
      return { externalId: mockId("gads_ad"), status: "active" };
    }

    try {
      const url = `https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/adGroupAds:mutate`;
      const res = await fetchWithRetry(url, {
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
                ad: {
                  finalUrls: ["https://example.com"],
                  responsiveSearchAd: {
                    headlines: [{ text: input.creative.headline }]
                  }
                },
              },
            },
          ],
        }),
      });

      const json = (await res.json()) as any;
      
      // Response validation
      if (!json || !json.results || !json.results[0]) {
        throw new Error("Malformed Google Ads API response payload. Missing results array.");
      }

      const resourceName = json.results[0].resourceName || mockId("gads_ad");
      logger.info(`Google Ads responsive search ad placed successfully: ${resourceName}`);
      return { externalId: resourceName, status: "active" };
    } catch (err) {
      logger.error("Failed to launch campaign variant on Google Ads API", err);
      throw err;
    }
  },

  async pauseVariant(externalId: string): Promise<void> {
    logger.info(`Initializing pauseVariant on Google Ads for resource: ${externalId}`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock pausing Google Ads variant.");
      return;
    }

    try {
      const url = `https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/adGroupAds:mutate`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [{ update: { resourceName: externalId, status: "PAUSED" } }]
        }),
      });
      logger.info(`Google Ads resource successfully paused: ${externalId}`);
    } catch (err) {
      logger.error("Failed to pause Google Ads campaign variant", err);
      throw err;
    }
  },

  async setBudget(input: SetBudgetInput): Promise<void> {
    logger.info(`Updating daily budget for Google Ads resource: ${input.externalId} to ${input.dailyBudgetCents} cents`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock budget change complete.");
      return;
    }

    try {
      const url = `https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/campaignBudgets:mutate`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [{
            update: {
              resourceName: input.externalId,
              amountMicros: input.dailyBudgetCents * 10000 // Convert cents to micros
            }
          }],
        }),
      });
      logger.info("Google Ads campaign budget mutation successfully applied.");
    } catch (err) {
      logger.error("Failed to modify campaign budget on Google Ads API", err);
      throw err;
    }
  },

  async fetchInsights(externalId: string) {
    logger.info(`Fetching performance insights for Google Ads resource: ${externalId}`);
    
    if (!hasLiveCredentials) {
      const impressions = Math.floor(1500 + Math.random() * 9000);
      const clicks = Math.floor(impressions * (0.015 + Math.random() * 0.035));
      const conversions = Math.floor(clicks * (0.03 + Math.random() * 0.07));
      const spendCents = Math.floor(clicks * (40 + Math.random() * 80));
      logger.info(`Offline mode. Generated mock insights metrics for ${externalId}`);
      return { impressions, clicks, conversions, spendCents };
    }

    try {
      const query = `SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
                     FROM ad_group_ad WHERE ad_group_ad.resource_name = '${externalId}'`;
      const url = `https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
      const res = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({ query }),
      });

      const json = (await res.json()) as any;
      
      // Response validation
      if (!json || !json.results || !json.results[0]) {
        logger.warn(`No search results returned for Google Ads resource: ${externalId}. Returning zero metrics.`);
        return { impressions: 0, clicks: 0, conversions: 0, spendCents: 0 };
      }

      const metrics = json.results[0].metrics || {};
      const stats = {
        impressions: Number(metrics.impressions ?? 0),
        clicks: Number(metrics.clicks ?? 0),
        conversions: Number(metrics.conversions ?? 0),
        spendCents: Math.round(Number(metrics.costMicros ?? 0) / 10000),
      };
      logger.info(`Google Ads insights metrics fetched: Clicks: ${stats.clicks}, Spend: ${stats.spendCents} cents`);
      return stats;
    } catch (err) {
      logger.error("Failed to query Google Ads performance statistics", err);
      throw err;
    }
  },
};
