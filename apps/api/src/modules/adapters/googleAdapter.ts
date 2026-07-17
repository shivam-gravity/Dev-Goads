import type {
  AdAdapter,
  HierarchyCapableAdapter,
  LaunchVariantInput,
  LaunchVariantResult,
  SetBudgetInput,
  CampaignContainerInput,
  AdSetContainerInput,
  CreativeUploadInput,
  CreativeUploadResult,
  HierarchyAdInput,
} from "./AdAdapter.js";
import type { GoogleAdsCredentials } from "../integrations/googleOAuth.js";
import { logger } from "../logger/logger.js";

const ADS_API_VERSION = "v24";
const ADS_API_BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

const ENV_GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const ENV_GOOGLE_ADS_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID;
const ENV_GOOGLE_ADS_ACCESS_TOKEN = process.env.GOOGLE_ADS_ACCESS_TOKEN;
const hasLiveCredentials = Boolean(
  ENV_GOOGLE_ADS_DEVELOPER_TOKEN && ENV_GOOGLE_ADS_CUSTOMER_ID && ENV_GOOGLE_ADS_ACCESS_TOKEN
);

/** Three-tier fallback matching every other adapter: per-workspace OAuth credentials (Phase 2) > global env vars > mock. */
function resolveCredentials(explicit?: GoogleAdsCredentials): GoogleAdsCredentials | null {
  if (explicit) return explicit;
  if (hasLiveCredentials) {
    return { accessToken: ENV_GOOGLE_ADS_ACCESS_TOKEN!, customerId: ENV_GOOGLE_ADS_CUSTOMER_ID!, developerToken: ENV_GOOGLE_ADS_DEVELOPER_TOKEN! };
  }
  return null;
}

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

async function adsMutate(customerId: string, developerToken: string, accessToken: string, resource: string, operations: unknown[]): Promise<any> {
  const res = await fetchWithRetry(`${ADS_API_BASE}/customers/${customerId}/${resource}:mutate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    },
    body: JSON.stringify({ operations }),
  });
  return res.json();
}

/** Best-effort removal of a CampaignBudget created just before a later step in campaign creation failed. */
async function cleanupOrphanedBudget(customerId: string, developerToken: string, accessToken: string, budgetResourceName: string): Promise<void> {
  try {
    await adsMutate(customerId, developerToken, accessToken, "campaignBudgets", [{ remove: budgetResourceName }]);
  } catch (err) {
    logger.warn(`Failed to clean up orphaned Google Ads budget ${budgetResourceName}`, err);
  }
}

const RSA_HEADLINE_MAX_CHARS = 30;
const RSA_DESCRIPTION_MAX_CHARS = 90;

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * Google requires at least 3 headlines and 2 descriptions for a Responsive Search Ad —
 * a single-headline/single-body creative (all this app generates today) would be
 * rejected outright. Synthesizes the minimum from the headline/body/CTA already on
 * hand rather than failing; a real improvement would have the AI generation pipeline
 * produce multiple variants directly.
 */
function buildResponsiveSearchAdAssets(creative: { headline: string; body: string; callToAction: string }) {
  const headlineCandidates = [creative.headline, creative.callToAction, `${creative.headline} — ${creative.callToAction}`];
  const descriptionCandidates = [creative.body, `${creative.body} ${creative.callToAction}.`];
  return {
    headlines: headlineCandidates.map((text) => ({ text: truncate(text, RSA_HEADLINE_MAX_CHARS) })),
    descriptions: descriptionCandidates.map((text) => ({ text: truncate(text, RSA_DESCRIPTION_MAX_CHARS) })),
  };
}

export const googleAdapter: AdAdapter & HierarchyCapableAdapter = {
  network: "google",

  async launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult> {
    logger.info(`Initializing launchVariant on Google Ads network for campaign: ${input.campaignId}`);

    if (!hasLiveCredentials) {
      logger.info("Credentials absent. Falling back to Google Ads mock ad placement.");
      return { externalId: mockId("gads_ad"), status: "active" };
    }

    try {
      const url = `https://googleads.googleapis.com/v24/customers/${ENV_GOOGLE_ADS_CUSTOMER_ID}/adGroupAds:mutate`;
      const res = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV_GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": ENV_GOOGLE_ADS_DEVELOPER_TOKEN!,
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
      const url = `https://googleads.googleapis.com/v24/customers/${ENV_GOOGLE_ADS_CUSTOMER_ID}/adGroupAds:mutate`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV_GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": ENV_GOOGLE_ADS_DEVELOPER_TOKEN!,
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

  async activateVariant(externalId: string): Promise<void> {
    logger.info(`Initializing activateVariant on Google Ads for resource: ${externalId}`);
    if (!hasLiveCredentials) {
      logger.info("Offline mode. Mock activating Google Ads variant.");
      return;
    }

    try {
      const url = `https://googleads.googleapis.com/v24/customers/${ENV_GOOGLE_ADS_CUSTOMER_ID}/adGroupAds:mutate`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV_GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": ENV_GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [{ update: { resourceName: externalId, status: "ENABLED" } }]
        }),
      });
      logger.info(`Google Ads resource successfully activated: ${externalId}`);
    } catch (err) {
      logger.error("Failed to activate Google Ads campaign variant", err);
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
      const url = `https://googleads.googleapis.com/v24/customers/${ENV_GOOGLE_ADS_CUSTOMER_ID}/campaignBudgets:mutate`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV_GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": ENV_GOOGLE_ADS_DEVELOPER_TOKEN!,
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
      // Google Search campaigns don't report a native unique-reach metric (that's a
      // Display/Video concept) — estimated the same plausible-fraction way as the mock
      // branch above, not queried, even once real credentials exist (see below).
      const reach = Math.floor(impressions * (0.5 + Math.random() * 0.3));
      const clicks = Math.floor(impressions * (0.015 + Math.random() * 0.035));
      const conversions = Math.floor(clicks * (0.03 + Math.random() * 0.07));
      const spendCents = Math.floor(clicks * (40 + Math.random() * 80));
      logger.info(`Offline mode. Generated mock insights metrics for ${externalId}`);
      return { impressions, reach, clicks, conversions, spendCents };
    }

    try {
      const query = `SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
                     FROM ad_group_ad WHERE ad_group_ad.resource_name = '${externalId}'`;
      const url = `https://googleads.googleapis.com/v24/customers/${ENV_GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
      const res = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV_GOOGLE_ADS_ACCESS_TOKEN}`,
          "developer-token": ENV_GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({ query }),
      });

      const json = (await res.json()) as any;

      // Response validation
      if (!json || !json.results || !json.results[0]) {
        logger.warn(`No search results returned for Google Ads resource: ${externalId}. Returning zero metrics.`);
        return { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0 };
      }

      const metrics = json.results[0].metrics || {};
      const impressions = Number(metrics.impressions ?? 0);
      const stats = {
        impressions,
        // No ad_group_ad-level reach field exists in the Google Ads API for Search — same
        // estimate as the mock branch, applied to the real impressions count.
        reach: Math.floor(impressions * 0.65),
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

  /* ─── Hierarchy path: real Campaign Budget -> Campaign (+ geo/language) -> Ad Group
     (+ age/gender/keywords) -> Ad object graph ─── */

  async createCampaignContainer(input: CampaignContainerInput, explicit?: unknown): Promise<{ externalId: string }> {
    const credentials = resolveCredentials(explicit as GoogleAdsCredentials | undefined);
    if (!credentials) return { externalId: mockId("gads_campaign") };
    const { accessToken, customerId, developerToken } = credentials;

    const budgetJson = await adsMutate(customerId, developerToken, accessToken, "campaignBudgets", [
      { create: { name: `${input.name} Budget`, amountMicros: String((input.dailyBudgetCents ?? 1000) * 10000), deliveryMethod: "STANDARD" } },
    ]);
    const budgetResourceName = budgetJson?.results?.[0]?.resourceName;
    if (!budgetResourceName) throw new Error(`Google campaign budget creation failed: ${JSON.stringify(budgetJson)}`);

    let campaignResourceName: string | undefined;
    try {
      const campaignJson = await adsMutate(customerId, developerToken, accessToken, "campaigns", [
        {
          create: {
            name: input.name,
            campaignBudget: budgetResourceName,
            advertisingChannelType: "SEARCH",
            status: "PAUSED",
            manualCpc: {},
            // Required as of newer API versions — a disclosure flag, not an actual ad
            // category. Missing this field causes campaign creation to be rejected.
            containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          },
        },
      ]);
      campaignResourceName = campaignJson?.results?.[0]?.resourceName;
      if (!campaignResourceName) throw new Error(`Google campaign creation failed: ${JSON.stringify(campaignJson)}`);

      const targeting = input.targeting as { geoTargetConstants?: string[]; languageConstant?: string } | undefined;
      if (targeting?.geoTargetConstants?.length || targeting?.languageConstant) {
        const criteriaOps = [
          ...(targeting.geoTargetConstants ?? []).map((geoTargetConstant) => ({
            create: { campaign: campaignResourceName, location: { geoTargetConstant } },
          })),
          ...(targeting.languageConstant ? [{ create: { campaign: campaignResourceName, language: { languageConstant: targeting.languageConstant } } }] : []),
        ];
        if (criteriaOps.length) await adsMutate(customerId, developerToken, accessToken, "campaignCriteria", criteriaOps);
      }

      if (input.conversionActionResourceName) {
        try {
          await adsMutate(customerId, developerToken, accessToken, "campaignConversionGoals", [
            { update: { campaign: campaignResourceName, conversionAction: input.conversionActionResourceName, biddable: true }, updateMask: "biddable" },
          ]);
        } catch (err) {
          // Real Google Ads conversion-goal mutations have account-state constraints
          // (e.g. requires the conversion action to already be attached at the account
          // level) — best-effort like the age/gender ad-group criteria above, doesn't
          // fail the whole campaign launch.
          logger.warn("Google campaign conversion-goal mutation failed — campaign created without a linked conversion action", err);
        }
      }
    } catch (err) {
      // The budget above was already created live on the account — clean it up rather
      // than leaving it dangling if a later step in this sequence fails (Google Ads has
      // no multi-resource atomic transaction across separate mutate calls).
      await cleanupOrphanedBudget(customerId, developerToken, accessToken, budgetResourceName);
      throw err;
    }

    return { externalId: campaignResourceName };
  },

  async createAdSetContainer(input: AdSetContainerInput, explicit?: unknown): Promise<{ externalId: string }> {
    const credentials = resolveCredentials(explicit as GoogleAdsCredentials | undefined);
    if (!credentials) return { externalId: mockId("gads_adgroup") };
    const { accessToken, customerId, developerToken } = credentials;

    const adGroupJson = await adsMutate(customerId, developerToken, accessToken, "adGroups", [
      { create: { name: input.name, campaign: input.campaignExternalId, status: "PAUSED", type: "SEARCH_STANDARD" } },
    ]);
    const adGroupResourceName = adGroupJson?.results?.[0]?.resourceName;
    if (!adGroupResourceName) throw new Error(`Google ad group creation failed: ${JSON.stringify(adGroupJson)}`);

    const targeting = input.targeting as { ageRanges?: string[]; genders?: string[]; keywords?: string[]; negativeKeywords?: string[] } | undefined;
    // Note: age/gender ad-group criteria are only honored by Google for Display/Video
    // campaigns — on a Search campaign (what this adapter creates) Google will reject
    // them. Left in place so this adapter is ready once channel type becomes configurable;
    // a rejected operation here fails the variant (caught by the orchestrator), not the launch.
    const criteriaOps = [
      ...(targeting?.ageRanges ?? []).map((type) => ({ create: { adGroup: adGroupResourceName, ageRange: { type } } })),
      ...(targeting?.genders ?? []).map((type) => ({ create: { adGroup: adGroupResourceName, gender: { type } } })),
      ...(targeting?.keywords ?? []).map((text) => ({ create: { adGroup: adGroupResourceName, keyword: { text, matchType: "BROAD" } } })),
      // Negative keywords (net-new) — same adGroupCriteria resource + BROAD match, flagged
      // negative. Produced only for a non-empty list, and it rides the single mutate + try/catch
      // below alongside the positive keywords, so a rejected negative can't fail the launch (the
      // ad group already exists; a criteria failure is logged and swallowed).
      ...(targeting?.negativeKeywords ?? []).map((text) => ({ create: { adGroup: adGroupResourceName, negative: true, keyword: { text, matchType: "BROAD" } } })),
    ];
    if (criteriaOps.length) {
      try {
        await adsMutate(customerId, developerToken, accessToken, "adGroupCriteria", criteriaOps);
      } catch (err) {
        logger.warn("Google ad group criteria mutation failed (age/gender criteria require Display/Video channel type) — ad group created without full targeting", err);
      }
    }

    return { externalId: adGroupResourceName };
  },

  async uploadCreativeAsset(_input: CreativeUploadInput): Promise<CreativeUploadResult> {
    // Responsive Search Ads (what createHierarchyAd below creates) are text-only —
    // no image/video asset upload needed, unlike Meta. Kept as a no-op so the shared
    // orchestrator code path doesn't need per-network branching.
    return {};
  },

  async createHierarchyAd(input: HierarchyAdInput, explicit?: unknown): Promise<LaunchVariantResult> {
    const credentials = resolveCredentials(explicit as GoogleAdsCredentials | undefined);
    if (!credentials) return { externalId: mockId("gads_ad"), status: "paused" };
    const { accessToken, customerId, developerToken } = credentials;

    const adJson = await adsMutate(customerId, developerToken, accessToken, "adGroupAds", [
      {
        create: {
          adGroup: input.adSetExternalId,
          status: "PAUSED",
          ad: {
            finalUrls: [input.landingPageUrl],
            responsiveSearchAd: buildResponsiveSearchAdAssets(input.creative),
          },
        },
      },
    ]);
    const resourceName = adJson?.results?.[0]?.resourceName;
    if (!resourceName) throw new Error(`Google ad creation failed: ${JSON.stringify(adJson)}`);

    return { externalId: resourceName, status: "paused" };
  },
};
