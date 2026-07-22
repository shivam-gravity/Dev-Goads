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

// Meta Insights date_preset values the Ads Manager range picker may request. Anything not in this
// set (e.g. a daily YYYY-MM-DD from the ingestion worker) is ignored and Meta's default window used.
const META_DATE_PRESETS = new Set(["today", "last_7d", "last_14d", "last_30d", "last_90d", "maximum"]);

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
  // Every call site builds the Graph path as `act_${adAccountId}`, so the stored id must be BARE.
  // The CRM SSO handoff (and some OAuth flows) persist it already-prefixed as `act_<n>`, which
  // otherwise yields `act_act_<n>` and a GraphMethodException (subcode 33, "object does not exist").
  // Normalize here, once, so all six endpoints get exactly one prefix regardless of source.
  const bare = (c: MetaCredentials): MetaCredentials =>
    c.adAccountId ? { ...c, adAccountId: String(c.adAccountId).replace(/^act_/, "") } : c;
  if (explicit) return bare(explicit);
  if (hasLiveCredentials) return bare({ accessToken: ENV_META_ACCESS_TOKEN!, adAccountId: ENV_META_AD_ACCOUNT_ID!, currency: "USD" });
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

/**
 * Meta rejects an ad set whose daily budget is below its per-currency minimum (error subcode
 * 1885272, "Budget is too low") — an ad set under the floor never delivers, so publishing a
 * split-too-thin budget silently fails every variant. A campaign budget divided across several
 * audience ad sets easily drops each below the floor (e.g. $50 / 16 variants on an INR account).
 * We floor each ad set to the minimum: spending the viable minimum beats not delivering at all.
 * Values are Meta's documented ~$1-equivalent/day minimums in WHOLE currency units; unknown
 * currencies fall back to the USD-equivalent 100 cents. Currency-scaled, not a flat number.
 */
const META_MIN_DAILY_BUDGET_WHOLE_UNITS: Record<string, number> = {
  USD: 1, EUR: 1, GBP: 1, CAD: 1, AUD: 1, SGD: 1,
  INR: 100, JPY: 100, MXN: 20, BRL: 5, ZAR: 20, THB: 40, PHP: 60, TRY: 20,
};

function floorAdSetBudgetCents(dailyBudgetCents: number, currency: string): number {
  const minWhole = META_MIN_DAILY_BUDGET_WHOLE_UNITS[currency.toUpperCase()] ?? 1;
  const minCents = minWhole * 100; // app-internal budgets are always wholeUnits * 100
  return Math.max(dailyBudgetCents, minCents);
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

  async launchVariant(input: LaunchVariantInput, credentials?: MetaCredentials): Promise<LaunchVariantResult> {
    logger.info(`Initializing launchVariant on Meta Marketing network for campaign: ${input.campaignId}`);

    // Resolve per-workspace credentials FIRST (explicit > global env > null). Never read the
    // global env tokens without checking the explicit workspace credentials — otherwise a caller
    // that doesn't thread creds through would publish into whatever global ad account the env
    // vars happen to point at, cross-tenant.
    const creds = resolveCredentials(credentials);
    if (!creds) {
      logger.info("Credentials absent. Falling back to Meta Ads mock placement.");
      return { externalId: mockId("meta_ad"), status: "active" };
    }

    try {
      const url = `${GRAPH_BASE}/act_${creds.adAccountId}/ads?access_token=${creds.accessToken}`;
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

  async fetchInsights(externalId: string, dateOrPreset?: string, credentials?: MetaCredentials) {
    logger.info(`Fetching performance insights for Meta Ads resource: ${externalId}`);
    const creds = resolveCredentials(credentials);

    if (!creds) {
      // No connected Meta account → NO fabricated metrics. Return real zeros so the pipeline and
      // every downstream surface (Analytics, Dashboard, Ads Manager) show an honest "no data yet"
      // state instead of Math.random()-invented performance presented as real.
      logger.info(`No Meta credentials for ${externalId} — returning zero metrics (no fabricated data).`);
      return { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0, revenueCents: 0 };
    }

    try {
      // Honor a Meta date_preset (last_7d/last_14d/last_30d/last_90d/today/maximum) when the caller
      // passes one, so the Ads Manager date-range picker actually scopes the numbers. A bare
      // YYYY-MM-DD (the daily-ingestion caller) or nothing falls through to Meta's default window.
      const preset = META_DATE_PRESETS.has(dateOrPreset ?? "") ? `&date_preset=${dateOrPreset}` : "";
      // action_values carries the real purchase VALUE (revenue) per action_type, parallel to
      // `actions` which carries the COUNT — both are needed for true ROAS (revenue / spend).
      const url = `${GRAPH_BASE}/${externalId}/insights?fields=impressions,reach,clicks,actions,action_values,spend${preset}&access_token=${creds.accessToken}`;
      const res = await fetchWithRetry(url, { method: "GET" });
      const json = (await res.json()) as any;

      if (!json || !json.data) {
        logger.warn(`No stats returned in data array for Meta Ads resource: ${externalId}. Returning zero metrics.`);
        return { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0, revenueCents: 0 };
      }

      const row = json.data[0] || {};
      const actions: any[] = row.actions || [];
      const actionValues: any[] = row.action_values || [];
      // Meta reports each conversion step under its own action_type; naming varies across pixel
      // setups (bare `purchase` vs the fully-qualified `offsite_conversion.fb_pixel_purchase`),
      // so match either spelling. Sum in case both the generic and qualified rows are present
      // would double-count, so prefer the first match per step, in specificity order.
      const actionCount = (types: string[]): number => {
        for (const t of types) {
          const hit = actions.find((a) => a.action_type === t)?.value;
          if (hit != null) return Number(hit);
        }
        return 0;
      };
      const conversions = actionCount(["offsite_conversion"]);
      const addToCart = actionCount(["offsite_conversion.fb_pixel_add_to_cart", "add_to_cart"]);
      const addPaymentInfo = actionCount(["offsite_conversion.fb_pixel_add_payment_info", "add_payment_info"]);
      const purchases = actionCount(["offsite_conversion.fb_pixel_purchase", "purchase"]);
      // Real revenue: the monetary value Meta attributes to the purchase pixel. Prefer the
      // generic `offsite_conversion` value; fall back to the explicit purchase action types some
      // pixel setups report under instead. In the account currency (dollars) → convert to cents.
      const revenueDollars =
        actionValues.find((a) => a.action_type === "offsite_conversion")?.value ??
        actionValues.find((a) => a.action_type === "offsite_conversion.fb_pixel_purchase")?.value ??
        actionValues.find((a) => a.action_type === "purchase")?.value ??
        0;
      const purchaseValueCents = Math.round(Number(revenueDollars) * 100);

      const stats = {
        impressions: Number(row.impressions ?? 0),
        reach: Number(row.reach ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: Number(conversions),
        spendCents: Math.round(Number(row.spend ?? 0) * 100),
        revenueCents: purchaseValueCents,
        funnel: { addToCart, addPaymentInfo, purchases, purchaseValueCents },
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
      // Budgets live at the ad-set level (ABO — see createAdSetContainer.daily_budget), so there is no
      // campaign-level budget. Meta now REQUIRES this flag be set explicitly for that case (Graph API
      // error subcode 4834011 otherwise). false = don't let ad sets share 20% of budget to optimize.
      is_adset_budget_sharing_enabled: false,
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
      daily_budget: toMetaMinorUnits(floorAdSetBudgetCents(input.dailyBudgetCents, credentials.currency), credentials.currency),
      billing_event: "IMPRESSIONS",
      // Meta requires OFFSITE_CONVERSIONS (not LINK_CLICKS) whenever a promoted_object/pixel is set.
      optimization_goal: input.promotedObject ? "OFFSITE_CONVERSIONS" : (input.objective ? resolveOptimizationGoal(input.objective as any, false) : "LINK_CLICKS"),
      // With ABO (ad-set budgets) and no campaign bid_strategy, Meta otherwise defaults to a
      // strategy that demands a bid cap / ROAS floor and rejects the ad set (subcode 2490487).
      // LOWEST_COST_WITHOUT_CAP is the "Lowest Cost" strategy that needs no bid amount — the same
      // default the native Meta wizard uses. A caller-supplied cap could switch this later.
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
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
