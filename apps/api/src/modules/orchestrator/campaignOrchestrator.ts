import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { metaAdapter } from "../adapters/metaAdapter.js";
import { googleAdapter } from "../adapters/googleAdapter.js";
import { tiktokAdapter } from "../adapters/tiktokAdapter.js";
import type { AdAdapter, HierarchyCapableAdapter } from "../adapters/AdAdapter.js";
import { resolveAudienceTargetingForWorkspace, withAgentInterests } from "../adapters/metaTargetingMapper.js";
import { isValidObjective } from "../adapters/metaObjectives.js";
import { resolveGoogleTargetingForWorkspace, buildGoogleCampaignTargetingFromLocations, withAgentKeywords } from "../adapters/googleTargetingMapper.js";
import { getMetaCredentials } from "../integrations/integrationService.js";
import { getGoogleAdsCredentials, type GoogleAdsCredentials } from "../integrations/googleOAuth.js";
import type { AdNetwork, Campaign, CampaignSuggestion, CampaignVariant, CreativeAssetRef } from "../../types/index.js";
import { getStrategy } from "../strategy/strategyEngine.js";
import { applyCopyLimitsForNetwork } from "../strategy/platformCopyLimits.js";
import { getBusiness } from "../business/businessService.js";
import { eventBus } from "../../infra/eventBus.js";
import { ensureFuseGuardrails } from "../automation/campaignFuse.js";
import { syncLaunchedHierarchy } from "../drafts/draftsService.js";
import { logger } from "../logger/logger.js";

export interface CampaignLaunchedEvent {
  campaignId: string;
  businessId: string;
  activeVariants: number;
  totalVariants: number;
}

const LANDING_PAGE_SLUGS = ["", "offer", "checkout", "pricing"];
const DEFAULT_META_OBJECTIVE = "OUTCOME_TRAFFIC";

const adapters: Record<AdNetwork, AdAdapter & Partial<HierarchyCapableAdapter>> = {
  meta: metaAdapter,
  google: googleAdapter,
  tiktok: tiktokAdapter,
};

export async function saveCampaign(campaign: Campaign): Promise<void> {
  await prisma.campaign.upsert({
    where: { id: campaign.id },
    create: { id: campaign.id, businessId: campaign.businessId, workspaceId: campaign.workspaceId, data: campaign as any, updatedAt: new Date(campaign.updatedAt) },
    update: { workspaceId: campaign.workspaceId, data: campaign as any, updatedAt: new Date(campaign.updatedAt) },
  });
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const row = await prisma.campaign.findUnique({ where: { id } });
  return row ? (row.data as unknown as Campaign) : null;
}

export async function listCampaignsForBusiness(businessId: string): Promise<Campaign[]> {
  const rows = await prisma.campaign.findMany({ where: { businessId }, orderBy: { updatedAt: "desc" } });
  return rows.map((r) => r.data as unknown as Campaign);
}

/** Powers the scheduled metrics-ingestion worker — every campaign currently spending, across every business/workspace, via a Postgres JSON-path filter on the schemaless `data` column. workspaceId falls back to "demo" for the rare pre-existing row launched before campaign.workspaceId started being persisted. */
export async function listActiveCampaigns(): Promise<{ id: string; workspaceId: string }[]> {
  const rows = await prisma.campaign.findMany({ where: { data: { path: ["status"], equals: "active" } }, select: { id: true, workspaceId: true } });
  return rows.map((r) => ({ id: r.id, workspaceId: r.workspaceId ?? "demo" }));
}

/** Builds a campaign draft from a strategy: one variant per creative x recommended network.
 * `objective` (optional) is the user-chosen Meta objective from the generation flow, stamped
 * onto the campaign so launchMetaHierarchy uses it instead of the hardcoded default. */
export async function buildCampaignFromStrategy(strategyId: string, name: string, dailyBudgetCents: number, objective?: string): Promise<Campaign> {
  const strategy = await getStrategy(strategyId);
  if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
  const business = await getBusiness(strategy.businessId);
  const baseUrl = business?.website?.replace(/\/$/, "") ?? "https://example.com";

  let variantIndex = 0;
  // Each creative is shared across every recommended network above — applying each
  // network's real copy limits here (rather than reusing one Meta-shaped 40-char headline
  // verbatim on Google/TikTok too) is what actually makes the final launched ad respect
  // that network's real format instead of just its generation-time upper bound.
  const variants: CampaignVariant[] = strategy.creatives.flatMap((creative) =>
    strategy.recommendedNetworks.map((network) => {
      const audienceName = strategy.audiences[variantIndex % strategy.audiences.length] ?? "General Audience";
      const slug = LANDING_PAGE_SLUGS[variantIndex % LANDING_PAGE_SLUGS.length];
      variantIndex++;
      return {
        id: randomUUID(),
        creative: applyCopyLimitsForNetwork(creative, network),
        network,
        status: "draft" as const,
        audienceName,
        landingPageUrl: slug ? `${baseUrl}/${slug}` : `${baseUrl}/`,
      };
    })
  );

  const campaign: Campaign = {
    id: randomUUID(),
    businessId: strategy.businessId,
    // Stamp the owning workspace at BUILD time (from the business), not only at launch. Without
    // this a generated-but-unlaunched campaign persisted with workspaceId=null and was invisible
    // to every workspace-scoped query — including the CRM Automated Insights tab, which filters
    // campaigns by workspaceId. launchCampaign still sets it too (defensive), but stamping here
    // means the campaign belongs to its workspace the moment it's created.
    ...(business?.workspaceId ? { workspaceId: business.workspaceId } : {}),
    strategyId,
    name,
    status: "draft",
    networks: strategy.recommendedNetworks,
    dailyBudgetCents,
    variants,
    ...(objective ? { objective } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(strategy.googleKeywords ? { googleKeywords: strategy.googleKeywords } : {}),
    ...(strategy.metaInterests ? { metaInterests: strategy.metaInterests } : {}),
  };

  await saveCampaign(campaign);
  return campaign;
}

/**
 * Builds a campaign draft from a set of AI-generated CampaignSuggestions: exactly one variant
 * per suggestion, using that suggestion's own platform as the variant's network — unlike
 * buildCampaignFromStrategy's creative × recommendedNetworks cross-product, which would put
 * every creative on every network. This is what lets "Generate Campaign" land the user straight
 * in the builder with N ready-to-edit ads (one per suggestion) instead of a single generic ad.
 */
export async function buildCampaignFromSuggestions(strategyId: string, suggestions: CampaignSuggestion[], name: string, dailyBudgetCents: number): Promise<Campaign> {
  const strategy = await getStrategy(strategyId);
  if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
  const business = await getBusiness(strategy.businessId);
  const baseUrl = business?.website?.replace(/\/$/, "") ?? "https://example.com";

  const variants: CampaignVariant[] = suggestions.map((suggestion, i) => {
    const audienceName = strategy.audiences[i % strategy.audiences.length] ?? "General Audience";
    const slug = LANDING_PAGE_SLUGS[i % LANDING_PAGE_SLUGS.length];
    return {
      id: randomUUID(),
      creative: { headline: suggestion.headline, body: suggestion.body, callToAction: suggestion.callToAction },
      network: suggestion.platform,
      status: "draft" as const,
      audienceName,
      landingPageUrl: slug ? `${baseUrl}/${slug}` : `${baseUrl}/`,
    };
  });

  const campaign: Campaign = {
    id: randomUUID(),
    businessId: strategy.businessId,
    strategyId,
    name,
    status: "draft",
    networks: [...new Set(variants.map((v) => v.network))],
    dailyBudgetCents,
    variants,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveCampaign(campaign);
  return campaign;
}

/**
 * Builds the real Meta object graph for a shared group of variants: one Campaign
 * container, one Ad Set per distinct audience (grouping variants so they share
 * budget/targeting the way Meta expects), then a Creative + Ad per variant.
 * Everything lands PAUSED — activateVariant is a separate, explicit step since this
 * is now capable of spending real money.
 */
async function launchMetaHierarchy(
  campaign: Campaign,
  variants: CampaignVariant[],
  workspaceId: string,
  perVariantBudgetCents: number
): Promise<void> {
  const workspaceCredentials = (await getMetaCredentials(workspaceId)) ?? undefined;
  // The builder lets a user pick a specific ad account/Page per campaign (dropdowns backed by
  // metaOAuth.listAdAccounts/listPages) instead of always using the workspace's default
  // Integration connection — override here when the campaign carries a selection.
  const credentials = workspaceCredentials
    ? {
        ...workspaceCredentials,
        adAccountId: campaign.metaAdAccountId ?? workspaceCredentials.adAccountId,
        pageId: campaign.pageId ?? workspaceCredentials.pageId,
      }
    : undefined;
  const accessToken = credentials?.accessToken ?? null;

  // Use the campaign's chosen objective (threaded from the generation flow) when it's a valid
  // post-ODAX Meta objective; otherwise fall back to the historical default. Guards against a
  // stale/free-text value reaching the Graph API.
  const metaObjective = campaign.objective && isValidObjective(campaign.objective) ? campaign.objective : DEFAULT_META_OBJECTIVE;

  let campaignExternalId: string;
  try {
    const container = await metaAdapter.createCampaignContainer!({ name: campaign.name, objective: metaObjective }, credentials);
    campaignExternalId = container.externalId;
    campaign.externalIds = { ...campaign.externalIds, meta: campaignExternalId };
  } catch {
    variants.forEach((v) => { v.status = "failed"; });
    return;
  }

  const groups = new Map<string, CampaignVariant[]>();
  for (const variant of variants) {
    const key = variant.audienceName ?? "General Audience";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(variant);
  }

  for (const [audienceName, groupVariants] of groups) {
    try {
      const baseTargeting = await resolveAudienceTargetingForWorkspace(workspaceId, audienceName, accessToken);
      const targeting = await withAgentInterests(baseTargeting, campaign.metaInterests, accessToken);
      const adSet = await metaAdapter.createAdSetContainer!(
        {
          campaignExternalId,
          name: `${campaign.name} — ${audienceName}`,
          dailyBudgetCents: perVariantBudgetCents * groupVariants.length,
          objective: metaObjective,
          targeting,
          promotedObject: campaign.pixelId && campaign.conversionEvent ? { pixelId: campaign.pixelId, customEventType: campaign.conversionEvent } : undefined,
          startTime: campaign.startDate,
          endTime: campaign.endDate,
          advantagePlus: campaign.advantagePlus,
        },
        credentials
      );

      for (const variant of groupVariants) {
        try {
          const upload = await metaAdapter.uploadCreativeAsset!(
            { imageUrl: variant.creative.imageUrl, videoUrl: variant.creative.videoUrl },
            credentials
          );
          const result = await metaAdapter.createHierarchyAd!(
            {
              adSetExternalId: adSet.externalId,
              name: `${campaign.id}-${variant.id}`,
              creative: variant.creative,
              landingPageUrl: variant.landingPageUrl ?? campaign.finalUrl ?? "https://example.com",
              imageHash: upload.imageHash,
              videoId: upload.videoId,
              instagramActorId: campaign.instagramAccountId,
            },
            credentials
          );
          variant.externalId = result.externalId;
          variant.status = result.status;
          variant.adSetExternalId = adSet.externalId;
        } catch {
          variant.status = "failed";
        }
      }
    } catch {
      groupVariants.forEach((v) => { v.status = "failed"; });
    }
  }
}

/**
 * Builds the real Google Ads object graph for a shared group of variants: one Campaign
 * Budget + Campaign (geo/language targeting from the first audience group — Google
 * budgets/geo/language are campaign-level, unlike Meta's per-ad-set model), then one Ad
 * Group per distinct audience (age/gender/keyword criteria), then a Responsive Search Ad
 * per variant. Everything lands PAUSED, same safety default as Meta.
 */
async function launchGoogleHierarchy(
  campaign: Campaign,
  variants: CampaignVariant[],
  workspaceId: string,
  perVariantBudgetCents: number
): Promise<void> {
  // Same builder-selection override pattern as launchMetaHierarchy: the campaign builder lets a
  // user pick a specific Google Ads customer per campaign instead of always using the workspace's
  // default Integration connection.
  const applyCustomerOverride = (c?: GoogleAdsCredentials) =>
    c ? { ...c, customerId: campaign.googleCustomerId ?? c.customerId } : undefined;
  let credentials = applyCustomerOverride((await getGoogleAdsCredentials(workspaceId)) ?? undefined);

  // A stored Google access token can be dead while its recorded expiry still reads "in the future"
  // (e.g. the CRM manual-connect path stores an optimistic tokenExpiresAt) — so the normal refresh
  // gate never fires and the first live call 401s. Probe the first API call (campaign container),
  // and on an auth failure force a token refresh from the refresh token and retry ONCE. This runs
  // before any variant is persisted, so a clean top-of-hierarchy retry has no partial-state risk.
  const isAuthError = (err: unknown) => /\b401\b|UNAUTHENTICATED|invalid authentication/i.test(String((err as Error)?.message ?? err));

  const groups = new Map<string, CampaignVariant[]>();
  for (const variant of variants) {
    const key = variant.audienceName ?? "General Audience";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(variant);
  }
  const [firstAudienceName] = groups.keys();

  let accessToken = credentials?.accessToken ?? null;
  let developerToken = credentials?.developerToken ?? null;

  const buildContainer = async () => {
    // Locations collected directly in the builder take precedence over the SavedAudience-name
    // bridge (which strategy-generated variants without builder state still rely on).
    const campaignLevelGeoTargeting = campaign.locations?.length
      ? await buildGoogleCampaignTargetingFromLocations(accessToken, developerToken, campaign.locations)
      : (await resolveGoogleTargetingForWorkspace(workspaceId, firstAudienceName, accessToken, developerToken)).campaign;
    const conversionActionResourceName = credentials && campaign.googleConversionActionId
      ? `customers/${credentials.customerId}/conversionActions/${campaign.googleConversionActionId}`
      : undefined;
    return googleAdapter.createCampaignContainer!(
      { name: campaign.name, objective: "SEARCH", dailyBudgetCents: campaign.dailyBudgetCents, targeting: campaignLevelGeoTargeting, conversionActionResourceName },
      credentials
    );
  };

  let campaignExternalId: string;
  try {
    let container;
    try {
      container = await buildContainer();
    } catch (err) {
      // On an auth failure, mint a genuinely fresh token (bypassing the possibly-stale expiry gate)
      // and retry the container once. If it still fails, fall through to the outer catch.
      if (!isAuthError(err)) throw err;
      logger.warn(`launchGoogleHierarchy: auth error on first call for ${workspaceId} — force-refreshing token and retrying once`);
      credentials = applyCustomerOverride((await getGoogleAdsCredentials(workspaceId, { forceRefresh: true })) ?? undefined);
      accessToken = credentials?.accessToken ?? null;
      developerToken = credentials?.developerToken ?? null;
      container = await buildContainer();
    }
    campaignExternalId = container.externalId;
    campaign.externalIds = { ...campaign.externalIds, google: campaignExternalId };
  } catch {
    variants.forEach((v) => { v.status = "failed"; });
    return;
  }

  for (const [audienceName, groupVariants] of groups) {
    try {
      const targeting = await resolveGoogleTargetingForWorkspace(workspaceId, audienceName, accessToken, developerToken);
      const adGroup = await googleAdapter.createAdSetContainer!(
        {
          campaignExternalId,
          name: `${campaign.name} — ${audienceName}`,
          dailyBudgetCents: perVariantBudgetCents * groupVariants.length,
          targeting: withAgentKeywords(targeting.adGroup, campaign.googleKeywords),
        },
        credentials
      );

      for (const variant of groupVariants) {
        try {
          const result = await googleAdapter.createHierarchyAd!(
            {
              adSetExternalId: adGroup.externalId,
              name: `${campaign.id}-${variant.id}`,
              creative: variant.creative,
              landingPageUrl: variant.landingPageUrl ?? campaign.finalUrl ?? "https://example.com",
            },
            credentials
          );
          variant.externalId = result.externalId;
          variant.status = result.status;
          variant.adSetExternalId = adGroup.externalId;
        } catch {
          variant.status = "failed";
        }
      }
    } catch {
      groupVariants.forEach((v) => { v.status = "failed"; });
    }
  }
}

/**
 * Launches every draft variant. Meta and Google variants go through their real object-graph
 * hierarchies (launchMetaHierarchy/launchGoogleHierarchy); TikTok keeps today's flat
 * per-variant launchVariant call until it gets the same depth in a follow-up.
 */
export async function launchCampaign(campaignId: string, workspaceId = "demo"): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  campaign.status = "launching";
  // Persisted so later reads (e.g. the scheduled metrics-ingestion worker, which only has a
  // campaignId to start from) know which workspace's Insight feed this campaign belongs to.
  campaign.workspaceId = workspaceId;
  const perVariantBudget = Math.floor(campaign.dailyBudgetCents / Math.max(campaign.variants.length, 1));

  const metaVariants = campaign.variants.filter((v) => v.network === "meta");
  const googleVariants = campaign.variants.filter((v) => v.network === "google");
  const otherVariants = campaign.variants.filter((v) => v.network !== "meta" && v.network !== "google");

  // Only Meta + Google are live. TikTok (and any other network) is "coming soon": we do NOT call
  // its adapter to launch, so it never gets an externalId and never spends. Marked "skipped" so
  // it's visibly not-launched rather than silently failing. Flip this back on (restore the
  // adapter.launchVariant loop) when the network graduates from coming-soon.
  for (const variant of otherVariants) {
    variant.status = "skipped";
  }

  if (metaVariants.length) {
    await launchMetaHierarchy(campaign, metaVariants, workspaceId, perVariantBudget);
  }
  if (googleVariants.length) {
    await launchGoogleHierarchy(campaign, googleVariants, workspaceId, perVariantBudget);
  }

  // `networks` was previously frozen at strategy-creation time (buildCampaignFromStrategy),
  // so it could drift from reality once the builder added/removed per-network ads afterward —
  // e.g. still reading ["meta"] after a Google ad was added and published. Recomputed here
  // from actual variant outcomes so it never contradicts externalIds or the real launch
  // result, which matters for anything reading this field downstream (the CRM sync in
  // particular — see adsDataRoutes.ts's /ads-data/campaigns).
  campaign.networks = [...new Set(campaign.variants.filter((v) => v.status !== "failed").map((v) => v.network))];

  campaign.status = campaign.variants.some((v) => v.status === "active")
    ? "active"
    : campaign.variants.some((v) => v.status === "paused")
      ? "paused"
      : "failed";
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);

  // Mirror the launched platform hierarchy into the AdSet/Ad tables the Ads Manager reads, so a
  // published campaign's ads actually show up there (they're otherwise only on the campaign's
  // variants JSON + the ad network). Best-effort: a mirror failure must not fail the launch.
  try {
    await syncLaunchedHierarchy(campaign.id, campaign.workspaceId, campaign.variants as any);
  } catch (err) {
    logger.warn(`launchCampaign: failed to mirror launched hierarchy into Ads Manager tables for ${campaign.id}`, err);
  }

  // Seed the always-on safety guardrails ("fuse") for this workspace the moment a campaign goes
  // live, so absolute max-CPA / min-ROAS / spend-cap protection is active by default rather than
  // only when a user hand-creates rules. Idempotent + best-effort: never block or fail a launch on it.
  if (campaign.status !== "failed" && campaign.workspaceId) {
    try {
      await ensureFuseGuardrails(campaign.workspaceId);
    } catch (err) {
      logger.warn(`launchCampaign: failed to seed fuse guardrails for ${campaign.workspaceId}`, err);
    }
  }

  // Fire-and-forget: today's only subscriber just logs (see src/infra/eventHandlers.ts),
  // but this is the exact seam roadmap Phase 3 replaces with a Kafka producer once the
  // Analytics/Notification workers become separate consumers of "campaign.launched".
  await eventBus.publish<CampaignLaunchedEvent>("campaign.launched", {
    campaignId: campaign.id,
    businessId: campaign.businessId,
    activeVariants: campaign.variants.filter((v) => v.status === "active").length,
    totalVariants: campaign.variants.length,
  });

  return campaign;
}

export async function pauseVariant(campaignId: string, variantId: string): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const variant = campaign.variants.find((v) => v.id === variantId);
  if (!variant || !variant.externalId) throw new Error(`Variant ${variantId} not launched`);

  const credentials = variant.network === "meta" ? (await getMetaCredentials(campaign.workspaceId ?? "demo")) ?? undefined : undefined;
  await adapters[variant.network].pauseVariant(variant.externalId, credentials);
  variant.status = "paused";
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);
  return campaign;
}

/** Flips a launched-but-paused variant to active — the explicit "spend real money now" step. */
export async function activateVariant(campaignId: string, variantId: string): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const variant = campaign.variants.find((v) => v.id === variantId);
  if (!variant || !variant.externalId) throw new Error(`Variant ${variantId} not launched`);

  const credentials = variant.network === "meta" ? (await getMetaCredentials(campaign.workspaceId ?? "demo")) ?? undefined : undefined;
  await adapters[variant.network].activateVariant(variant.externalId, credentials);
  variant.status = "active";
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);
  return campaign;
}

export async function reallocateBudget(campaignId: string, variantId: string, dailyBudgetCents: number): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const variant = campaign.variants.find((v) => v.id === variantId);
  if (!variant || !variant.externalId) throw new Error(`Variant ${variantId} not launched`);

  const credentials = variant.network === "meta" ? (await getMetaCredentials(campaign.workspaceId ?? "demo")) ?? undefined : undefined;
  const targetExternalId = variant.adSetExternalId ?? variant.externalId;
  await adapters[variant.network].setBudget({ externalId: targetExternalId, dailyBudgetCents }, credentials);
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);
  return campaign;
}

/**
 * Attaches AI-generated media (from creativeGenerationService) to every draft variant
 * that doesn't already have an image/video — a simplified bridge between the wizard's
 * one-generation-per-campaign flow and buildCampaignFromStrategy's per-network/per-creative
 * variants, which strategyEngine produces with text-only copy today.
 */
export async function applyCreativeMedia(campaignId: string, media: { imageUrl?: string; videoUrl?: string }): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  for (const variant of campaign.variants) {
    if (media.imageUrl && !variant.creative.imageUrl) variant.creative.imageUrl = media.imageUrl;
    if (media.videoUrl && !variant.creative.videoUrl) variant.creative.videoUrl = media.videoUrl;
  }
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);
  return campaign;
}

export interface CampaignBuilderPatch {
  name?: string;
  dailyBudgetCents?: number;
  conversionEvent?: string;
  finalUrl?: string;
  startDate?: string;
  endDate?: string;
  locations?: string[];
  advantagePlus?: boolean;
  metaAdAccountId?: string;
  pageId?: string;
  instagramAccountId?: string;
  pixelId?: string;
  googleCustomerId?: string;
  googleConversionActionId?: string;
  variants?: CampaignVariant[];
  creativeAssets?: CreativeAssetRef[];
}

export async function updateCampaign(campaignId: string, patch: CampaignBuilderPatch): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (patch.name !== undefined) campaign.name = patch.name;
  if (patch.dailyBudgetCents !== undefined) campaign.dailyBudgetCents = patch.dailyBudgetCents;
  if (patch.conversionEvent !== undefined) campaign.conversionEvent = patch.conversionEvent;
  if (patch.finalUrl !== undefined) campaign.finalUrl = patch.finalUrl;
  if (patch.startDate !== undefined) campaign.startDate = patch.startDate;
  if (patch.endDate !== undefined) campaign.endDate = patch.endDate;
  if (patch.locations !== undefined) campaign.locations = patch.locations;
  if (patch.advantagePlus !== undefined) campaign.advantagePlus = patch.advantagePlus;
  if (patch.metaAdAccountId !== undefined) campaign.metaAdAccountId = patch.metaAdAccountId;
  if (patch.pageId !== undefined) campaign.pageId = patch.pageId;
  if (patch.instagramAccountId !== undefined) campaign.instagramAccountId = patch.instagramAccountId;
  if (patch.pixelId !== undefined) campaign.pixelId = patch.pixelId;
  if (patch.googleCustomerId !== undefined) campaign.googleCustomerId = patch.googleCustomerId;
  if (patch.googleConversionActionId !== undefined) campaign.googleConversionActionId = patch.googleConversionActionId;
  if (patch.variants !== undefined) campaign.variants = patch.variants;
  // Capped at 10 server-side, not just in the UI.
  if (patch.creativeAssets !== undefined) campaign.creativeAssets = patch.creativeAssets.slice(0, 10);
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);
  return campaign;
}

export { adapters };
