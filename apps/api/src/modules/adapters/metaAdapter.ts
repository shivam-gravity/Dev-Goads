import type {
  AdAdapter,
  HierarchyCapableAdapter,
  LaunchVariantInput,
  LaunchVariantResult,
  SetBudgetInput,
  MetaCredentials,
  CampaignContainerInput,
  AdSetContainerInput,
  CreativeUploadInput,
  CreativeUploadResult,
  HierarchyAdInput,
} from "./AdAdapter.js";
import { resolveOptimizationGoal } from "./metaObjectives.js";
import { logger } from "../logger/logger.js";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const ENV_META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const ENV_META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;
const hasLiveCredentials = Boolean(ENV_META_ACCESS_TOKEN && ENV_META_AD_ACCOUNT_ID);

function mockId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Three-tier fallback, same shape as every other adapter in this file: explicit
 * per-workspace OAuth credentials (Phase B) > global env-var credentials (legacy,
 * still supported for single-tenant/local setups) > null (mock mode).
 */
function resolveCredentials(explicit?: MetaCredentials): MetaCredentials | null {
  if (explicit) return explicit;
  if (hasLiveCredentials) return { accessToken: ENV_META_ACCESS_TOKEN!, adAccountId: ENV_META_AD_ACCOUNT_ID!, currency: "USD" };
  return null;
}

/**
 * Meta's minor-unit rules aren't a flat "always cents": zero-decimal currencies (JPY,
 * KRW, ...) have no minor unit at all, and a few (KWD, BHD, ...) use three decimal
 * places. `dailyBudgetCents` in this app is always `wholeUnits * 100` (the UI takes a
 * dollar-style amount), so recovering wholeUnits and reapplying the account's real
 * divisor keeps USD/EUR/INR-style accounts unchanged while fixing the outliers.
 */
const META_MINOR_UNIT_DIVISORS: Record<string, number> = {
  JPY: 1, KRW: 1, VND: 1, CLP: 1, HUF: 1, ISK: 1, TWD: 1, IDR: 1, MMK: 1, UGX: 1, GNF: 1, MGA: 1, PYG: 1, RWF: 1, XAF: 1, XOF: 1,
  KWD: 1000, BHD: 1000, OMR: 1000, JOD: 1000,
};

function toMetaMinorUnits(dailyBudgetCents: number, currency: string): number {
  const wholeUnits = dailyBudgetCents / 100;
  const divisor = META_MINOR_UNIT_DIVISORS[currency.toUpperCase()] ?? 100;
  return Math.round(wholeUnits * divisor);
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

async function graphPost(path: string, accessToken: string, body: Record<string, unknown>): Promise<any> {
  const url = `${GRAPH_BASE}${path}?access_token=${accessToken}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_MAX_ATTEMPTS = 40; // ~2 minutes

/**
 * Meta processes an uploaded video asynchronously — referencing its video_id in an ad
 * creative before processing finishes can fail. Polls status until ready/error/timeout
 * instead of trusting the upload response the way a naive integration would.
 */
async function waitForVideoProcessing(videoId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
    const url = `${GRAPH_BASE}/${videoId}?fields=status&access_token=${accessToken}`;
    const res = await fetchWithRetry(url, { method: "GET" });
    const json = (await res.json()) as { status?: { video_status?: string } };
    const videoStatus = json.status?.video_status;
    if (videoStatus === "ready") return;
    if (videoStatus === "error") throw new Error(`Meta video ${videoId} failed processing`);
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
  }
  throw new Error(`Meta video ${videoId} did not finish processing in time`);
}

async function setStatus(externalId: string, status: "PAUSED" | "ACTIVE", credentials?: MetaCredentials): Promise<void> {
  logger.info(`Setting Meta resource ${externalId} status to ${status}`);
  const creds = resolveCredentials(credentials);
  if (!creds) {
    logger.info(`Offline mode. Mock ${status === "ACTIVE" ? "activating" : "pausing"} Meta ad variant.`);
    return;
  }
  try {
    const url = `${GRAPH_BASE}/${externalId}?access_token=${creds.accessToken}`;
    await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    logger.info(`Meta resource ${externalId} status set to ${status}`);
  } catch (err) {
    logger.error(`Failed to set Meta resource ${externalId} status to ${status}`, err);
    throw err;
  }
}

export const metaAdapter: AdAdapter & HierarchyCapableAdapter = {
  network: "meta",

  async launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult> {
    logger.info(`Initializing launchVariant on Meta Marketing network for campaign: ${input.campaignId}`);

    if (!hasLiveCredentials) {
      logger.info("Credentials absent. Falling back to Meta Ads mock placement.");
      return { externalId: mockId("meta_ad"), status: "active" };
    }

    try {
      const url = `${GRAPH_BASE}/act_${ENV_META_AD_ACCOUNT_ID}/ads?access_token=${ENV_META_ACCESS_TOKEN}`;
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

  async pauseVariant(externalId: string, credentials?: MetaCredentials): Promise<void> {
    return setStatus(externalId, "PAUSED", credentials);
  },

  async activateVariant(externalId: string, credentials?: MetaCredentials): Promise<void> {
    return setStatus(externalId, "ACTIVE", credentials);
  },

  async setBudget(input: SetBudgetInput, credentials?: MetaCredentials): Promise<void> {
    logger.info(`Updating daily budget for Meta Ads resource: ${input.externalId} to ${input.dailyBudgetCents} cents`);
    const creds = resolveCredentials(credentials);
    if (!creds) {
      logger.info("Offline mode. Mock budget change complete.");
      return;
    }

    try {
      const url = `${GRAPH_BASE}/${input.externalId}?access_token=${creds.accessToken}`;
      await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_budget: toMetaMinorUnits(input.dailyBudgetCents, creds.currency) }),
      });
      logger.info("Meta daily campaign budget successfully modified.");
    } catch (err) {
      logger.error("Failed to modify daily budget on Meta Ads API", err);
      throw err;
    }
  },

  async fetchInsights(externalId: string, _date?: string, credentials?: MetaCredentials) {
    logger.info(`Fetching performance insights for Meta Ads resource: ${externalId}`);
    const creds = resolveCredentials(credentials);

    if (!creds) {
      const impressions = Math.floor(2000 + Math.random() * 8000);
      const reach = Math.floor(impressions * (0.55 + Math.random() * 0.3));
      const clicks = Math.floor(impressions * (0.01 + Math.random() * 0.04));
      const conversions = Math.floor(clicks * (0.02 + Math.random() * 0.08));
      const spendCents = Math.floor(clicks * (30 + Math.random() * 70));
      logger.info(`Offline mode. Generated mock insights metrics for ${externalId}`);
      return { impressions, reach, clicks, conversions, spendCents };
    }

    try {
      const url = `${GRAPH_BASE}/${externalId}/insights?fields=impressions,reach,clicks,actions,spend&access_token=${creds.accessToken}`;
      const res = await fetchWithRetry(url, { method: "GET" });
      const json = (await res.json()) as any;

      if (!json || !json.data) {
        logger.warn(`No stats returned in data array for Meta Ads resource: ${externalId}. Returning zero metrics.`);
        return { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0 };
      }

      const row = json.data[0] || {};
      const conversions = (row.actions || []).find((a: any) => a.action_type === "offsite_conversion")?.value ?? 0;

      const stats = {
        impressions: Number(row.impressions ?? 0),
        reach: Number(row.reach ?? 0),
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

  /* ─── Hierarchy path: real Campaign -> Ad Set -> Creative -> Ad object graph ─── */

  async createCampaignContainer(input: CampaignContainerInput, explicit?: MetaCredentials): Promise<{ externalId: string }> {
    const credentials = resolveCredentials(explicit);
    if (!credentials) return { externalId: mockId("meta_campaign") };

    const json = await graphPost(`/act_${credentials.adAccountId}/campaigns`, credentials.accessToken, {
      name: input.name,
      objective: input.objective,
      status: "PAUSED",
      special_ad_categories: [],
    });
    if (!json?.id) throw new Error(`Meta campaign creation failed: ${JSON.stringify(json)}`);
    return { externalId: json.id };
  },

  async createAdSetContainer(input: AdSetContainerInput, explicit?: MetaCredentials): Promise<{ externalId: string }> {
    const credentials = resolveCredentials(explicit);
    if (!credentials) return { externalId: mockId("meta_adset") };

    const body: Record<string, unknown> = {
      name: input.name,
      campaign_id: input.campaignExternalId,
      daily_budget: toMetaMinorUnits(input.dailyBudgetCents, credentials.currency),
      billing_event: "IMPRESSIONS",
      // Meta requires OFFSITE_CONVERSIONS (not LINK_CLICKS) whenever a promoted_object/pixel is set.
      optimization_goal: input.promotedObject ? "OFFSITE_CONVERSIONS" : (input.objective ? resolveOptimizationGoal(input.objective as any, false) : "LINK_CLICKS"),
      targeting: input.targeting,
      status: "PAUSED",
    };
    if (input.promotedObject) body.promoted_object = { pixel_id: input.promotedObject.pixelId, custom_event_type: input.promotedObject.customEventType };
    if (input.startTime) body.start_time = input.startTime;
    if (input.endTime) body.end_time = input.endTime;
    if (input.advantagePlus) body.targeting_automation = { advantage_audience: 1 };
    if (input.frequencyCap) {
      body.frequency_control_specs = [{
        event: "IMPRESSIONS",
        interval_days: input.frequencyCap.intervalDays,
        max_frequency: input.frequencyCap.maxImpressions,
      }];
    }

    const json = await graphPost(`/act_${credentials.adAccountId}/adsets`, credentials.accessToken, body);
    if (!json?.id) throw new Error(`Meta ad set creation failed: ${JSON.stringify(json)}`);
    return { externalId: json.id };
  },

  async uploadCreativeAsset(input: CreativeUploadInput, explicit?: MetaCredentials): Promise<CreativeUploadResult> {
    const credentials = resolveCredentials(explicit);
    if (!credentials) return input.videoUrl ? { videoId: mockId("meta_video") } : { imageHash: mockId("meta_imghash") };

    if (input.videoUrl) {
      const json = await graphPost(`/act_${credentials.adAccountId}/advideos`, credentials.accessToken, {
        file_url: input.videoUrl,
      });
      if (!json?.id) throw new Error(`Meta video upload failed: ${JSON.stringify(json)}`);
      await waitForVideoProcessing(json.id, credentials.accessToken);
      return { videoId: json.id };
    }

    if (input.imageUrl) {
      const json = await graphPost(`/act_${credentials.adAccountId}/adimages`, credentials.accessToken, {
        url: input.imageUrl,
      });
      const firstImage = json?.images ? Object.values(json.images)[0] as { hash?: string } | undefined : undefined;
      if (!firstImage?.hash) throw new Error(`Meta image upload failed: ${JSON.stringify(json)}`);
      return { imageHash: firstImage.hash };
    }

    // No image/video on this creative yet (e.g. a strategy-generated text-only variant
    // that hasn't been through AI image generation) — the ad still gets created, just
    // without image_hash/video_id, same graceful-degradation shape as the mock branches above.
    return {};
  },

  async createHierarchyAd(input: HierarchyAdInput, explicit?: MetaCredentials): Promise<LaunchVariantResult> {
    const credentials = resolveCredentials(explicit);
    if (!credentials) return { externalId: mockId("meta_ad"), status: "paused" };

    const linkData: Record<string, unknown> = {
      message: input.creative.body,
      link: input.landingPageUrl,
      name: input.creative.headline,
      call_to_action: { type: "LEARN_MORE", value: { link: input.landingPageUrl } },
    };
    if (input.imageHash) linkData.image_hash = input.imageHash;

    const objectStorySpec: Record<string, unknown> = { page_id: credentials.pageId };
    if (input.instagramActorId) objectStorySpec.instagram_actor_id = input.instagramActorId;
    if (input.videoId) {
      objectStorySpec.video_data = {
        video_id: input.videoId,
        message: input.creative.body,
        call_to_action: { type: "LEARN_MORE", value: { link: input.landingPageUrl } },
      };
    } else {
      objectStorySpec.link_data = linkData;
    }

    const creativeJson = await graphPost(`/act_${credentials.adAccountId}/adcreatives`, credentials.accessToken, {
      name: `${input.name}-creative`,
      object_story_spec: objectStorySpec,
    });
    if (!creativeJson?.id) throw new Error(`Meta ad creative creation failed: ${JSON.stringify(creativeJson)}`);

    const adJson = await graphPost(`/act_${credentials.adAccountId}/ads`, credentials.accessToken, {
      name: input.name,
      adset_id: input.adSetExternalId,
      creative: { creative_id: creativeJson.id },
      status: "PAUSED",
    });
    if (!adJson?.id) throw new Error(`Meta ad creation failed: ${JSON.stringify(adJson)}`);

    return { externalId: adJson.id, status: "paused" };
  },
};
