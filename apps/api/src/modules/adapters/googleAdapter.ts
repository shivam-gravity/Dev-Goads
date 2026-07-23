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

// Maps the Ads Manager range picker's Meta-style presets to GAQL predefined date ranges. Google
// has no built-in 14/90-day range, so last_14d falls back to LAST_30_DAYS and last_90d/maximum
// omit the clause entirely (account default). Presets not listed here disable the DURING clause.
const GOOGLE_DATE_RANGES: Record<string, string> = {
  today: "TODAY",
  last_7d: "LAST_7_DAYS",
  last_14d: "LAST_30_DAYS",
  last_30d: "LAST_30_DAYS",
};

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
// Google rejects an RSA with fewer than 3 headlines or 2 descriptions.
const RSA_MIN_HEADLINES = 3;
const RSA_MIN_DESCRIPTIONS = 2;
// Google's hard per-ad ceilings.
const RSA_MAX_HEADLINES = 15;
const RSA_MAX_DESCRIPTIONS = 4;

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1).trimEnd() + "…";
}

function dedupeAssets(values: string[], maxChars: number, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const text = truncate((raw ?? "").trim(), maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Builds the RSA headline/description assets Google actually publishes, from the creative's
 * multi-asset pools (`headlines` — up to 5 — and `descriptions` — up to 4 — populated by the AI
 * copy pipeline; see strategyEngine.withCreativeVariants). Each asset is truncated to Google's
 * per-asset limit (≤30 headline, ≤90 description) and de-duplicated.
 *
 * Google rejects an RSA with fewer than 3 headlines / 2 descriptions. If the pools are thin (e.g.
 * a creative built without a CreativeAgent result, or a legacy single-pair creative), we synthesize
 * the shortfall from the headline/body/CTA on hand rather than letting the API reject the ad — this
 * is the last safety net; the AI pipeline is expected to supply the full 5×4 set directly.
 */
export function buildResponsiveSearchAdAssets(creative: { headline: string; body: string; callToAction: string; headlines?: string[]; descriptions?: string[] }) {
  const headlines = dedupeAssets(
    creative.headlines?.length ? creative.headlines : [creative.headline],
    RSA_HEADLINE_MAX_CHARS,
    RSA_MAX_HEADLINES,
  );
  const descriptions = dedupeAssets(
    creative.descriptions?.length ? creative.descriptions : [creative.body],
    RSA_DESCRIPTION_MAX_CHARS,
    RSA_MAX_DESCRIPTIONS,
  );

  // Synthesize up to the required minimum only if the real pool fell short.
  const headlineFallbacks = [creative.callToAction, `${creative.headline} — ${creative.callToAction}`, creative.headline];
  for (const candidate of headlineFallbacks) {
    if (headlines.length >= RSA_MIN_HEADLINES) break;
    const text = truncate((candidate ?? "").trim(), RSA_HEADLINE_MAX_CHARS);
    if (text && !headlines.includes(text)) headlines.push(text);
  }
  const descriptionFallbacks = [`${creative.body} ${creative.callToAction}.`, creative.body];
  for (const candidate of descriptionFallbacks) {
    if (descriptions.length >= RSA_MIN_DESCRIPTIONS) break;
    const text = truncate((candidate ?? "").trim(), RSA_DESCRIPTION_MAX_CHARS);
    if (text && !descriptions.includes(text)) descriptions.push(text);
  }

  return {
    headlines: headlines.map((text) => ({ text })),
    descriptions: descriptions.map((text) => ({ text })),
  };
}

export const googleAdapter: AdAdapter & HierarchyCapableAdapter = {
  network: "google",

  async launchVariant(input: LaunchVariantInput, credentials?: unknown): Promise<LaunchVariantResult> {
    logger.info(`Initializing launchVariant on Google Ads network for campaign: ${input.campaignId}`);

    // Resolve per-workspace credentials FIRST (explicit > global env > null). Never read the
    // global env tokens without checking the explicit workspace credentials — otherwise a caller
    // that doesn't thread creds through would publish into whatever global customer the env vars
    // happen to point at, cross-tenant.
    const creds = resolveCredentials(credentials as GoogleAdsCredentials | undefined);
    if (!creds) {
      logger.info("Credentials absent. Falling back to Google Ads mock ad placement.");
      return { externalId: mockId("gads_ad"), status: "active" };
    }

    try {
      const url = `https://googleads.googleapis.com/v24/customers/${creds.customerId}/adGroupAds:mutate`;
      const res = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.accessToken}`,
          "developer-token": creds.developerToken,
        },
        body: JSON.stringify({
          operations: [
            {
              create: {
                status: "ENABLED",
                ad: {
                  finalUrls: ["https://example.com"],
                  // Full multi-asset RSA (up to 5 headlines / 4 descriptions from the creative's
                  // pools), not a single headline — Google rejects an RSA below 3 headlines / 2
                  // descriptions, which the previous single-headline payload would have hit.
                  responsiveSearchAd: buildResponsiveSearchAdAssets(input.creative),
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

  async pauseVariant(externalId: string, _credentials?: unknown): Promise<void> {
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

  async activateVariant(externalId: string, _credentials?: unknown): Promise<void> {
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

  async setBudget(input: SetBudgetInput, _credentials?: unknown): Promise<void> {
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

  async fetchInsights(externalId: string, dateOrPreset?: string, explicit?: GoogleAdsCredentials) {
    logger.info(`Fetching performance insights for Google Ads resource: ${externalId}`);
    const creds = resolveCredentials(explicit);

    if (!creds) {
      // No connected Google Ads account → NO fabricated metrics. Return real zeros for an honest
      // "no data yet" state instead of Math.random()-invented performance shown as real.
      logger.info(`No Google credentials for ${externalId} — returning zero metrics (no fabricated data).`);
      return { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0, revenueCents: 0 };
    }

    // Map the Ads Manager range picker's Meta-style presets to GAQL predefined date ranges. Google
    // has no >30-day preset, so last_90d/maximum omit the DURING clause (account default window).
    const duringClause = GOOGLE_DATE_RANGES[dateOrPreset ?? ""] ? ` DURING ${GOOGLE_DATE_RANGES[dateOrPreset ?? ""]}` : "";
    const url = `${ADS_API_BASE}/customers/${creds.customerId}/googleAds:search`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.accessToken}`,
      "developer-token": creds.developerToken,
    };

    try {
      // metrics.conversions_value is the real revenue Google attributes to the ad's conversions
      // (in the account currency, as a decimal) — needed for true ROAS (revenue / spend).
      // Unsegmented so impressions/clicks/cost aren't duplicated across rows.
      const query = `SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.cost_micros
                     FROM ad_group_ad WHERE ad_group_ad.resource_name = '${externalId}'${duringClause}`;
      const res = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify({ query }) });

      const json = (await res.json()) as any;

      // Response validation
      if (!json || !json.results || !json.results[0]) {
        logger.warn(`No search results returned for Google Ads resource: ${externalId}. Returning zero metrics.`);
        return { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0, revenueCents: 0 };
      }

      const metrics = json.results[0].metrics || {};
      const impressions = Number(metrics.impressions ?? 0);

      // Funnel breakout: segment conversions by conversion_action_category in a SEPARATE query so the
      // repeated core metrics (impressions/clicks/cost) from segmentation don't inflate the totals
      // above. Google's ecommerce categories map onto our Meta-shaped funnel: ADD_TO_CART → addToCart,
      // BEGIN_CHECKOUT → addPaymentInfo (closest analog; Google has no add_payment_info), PURCHASE →
      // purchases. Best-effort — a failure here must not drop the core metrics, so it's caught.
      const funnel = { addToCart: 0, addPaymentInfo: 0, purchases: 0, purchaseValueCents: 0 };
      try {
        const funnelQuery = `SELECT segments.conversion_action_category, metrics.conversions, metrics.conversions_value
                             FROM ad_group_ad WHERE ad_group_ad.resource_name = '${externalId}'${duringClause}`;
        const fRes = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify({ query: funnelQuery }) });
        const fJson = (await fRes.json()) as any;
        for (const row of fJson?.results ?? []) {
          const category = row?.segments?.conversionActionCategory;
          const count = Number(row?.metrics?.conversions ?? 0);
          const valueCents = Math.round(Number(row?.metrics?.conversionsValue ?? 0) * 100);
          if (category === "ADD_TO_CART") funnel.addToCart += count;
          else if (category === "BEGIN_CHECKOUT") funnel.addPaymentInfo += count;
          else if (category === "PURCHASE") { funnel.purchases += count; funnel.purchaseValueCents += valueCents; }
        }
      } catch (err) {
        logger.warn(`Google funnel breakdown query failed for ${externalId} — returning core metrics without funnel.`, err);
      }

      const stats = {
        impressions,
        // No ad_group_ad-level reach field exists in the Google Ads API for Search — same
        // estimate as the mock branch, applied to the real impressions count.
        reach: Math.floor(impressions * 0.65),
        clicks: Number(metrics.clicks ?? 0),
        conversions: Number(metrics.conversions ?? 0),
        spendCents: Math.round(Number(metrics.costMicros ?? 0) / 10000),
        // conversionsValue is a decimal currency amount (e.g. 129.99) → cents.
        revenueCents: Math.round(Number(metrics.conversionsValue ?? 0) * 100),
        funnel,
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
