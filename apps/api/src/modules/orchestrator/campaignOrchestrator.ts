import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { metaAdapter } from "../adapters/metaAdapter.js";
import { googleAdapter } from "../adapters/googleAdapter.js";
import { tiktokAdapter } from "../adapters/tiktokAdapter.js";
import type { AdAdapter, HierarchyCapableAdapter } from "../adapters/AdAdapter.js";
import { resolveAudienceTargetingForWorkspace } from "../adapters/metaTargetingMapper.js";
import { resolveGoogleTargetingForWorkspace } from "../adapters/googleTargetingMapper.js";
import { getMetaCredentials } from "../integrations/integrationService.js";
import { getGoogleAdsCredentials } from "../integrations/googleOAuth.js";
import type { AdNetwork, Campaign, CampaignVariant } from "../../types/index.js";
import { getStrategy } from "../strategy/strategyEngine.js";
import { getBusiness } from "../business/businessService.js";
import { eventBus } from "../../infra/eventBus.js";

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

async function saveCampaign(campaign: Campaign): Promise<void> {
  await prisma.campaign.upsert({
    where: { id: campaign.id },
    create: { id: campaign.id, businessId: campaign.businessId, data: campaign as any, updatedAt: new Date(campaign.updatedAt) },
    update: { data: campaign as any, updatedAt: new Date(campaign.updatedAt) },
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

/** Builds a campaign draft from a strategy: one variant per creative x recommended network. */
export async function buildCampaignFromStrategy(strategyId: string, name: string, dailyBudgetCents: number): Promise<Campaign> {
  const strategy = await getStrategy(strategyId);
  if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
  const business = await getBusiness(strategy.businessId);
  const baseUrl = business?.website?.replace(/\/$/, "") ?? "https://example.com";

  let variantIndex = 0;
  const variants: CampaignVariant[] = strategy.creatives.flatMap((creative) =>
    strategy.recommendedNetworks.map((network) => {
      const audienceName = strategy.audiences[variantIndex % strategy.audiences.length] ?? "General Audience";
      const slug = LANDING_PAGE_SLUGS[variantIndex % LANDING_PAGE_SLUGS.length];
      variantIndex++;
      return {
        id: randomUUID(),
        creative,
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
    strategyId,
    name,
    status: "draft",
    networks: strategy.recommendedNetworks,
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
  const credentials = (await getMetaCredentials(workspaceId)) ?? undefined;
  const accessToken = credentials?.accessToken ?? null;

  let campaignExternalId: string;
  try {
    const container = await metaAdapter.createCampaignContainer!({ name: campaign.name, objective: DEFAULT_META_OBJECTIVE }, credentials);
    campaignExternalId = container.externalId;
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
      const targeting = await resolveAudienceTargetingForWorkspace(workspaceId, audienceName, accessToken);
      const adSet = await metaAdapter.createAdSetContainer!(
        {
          campaignExternalId,
          name: `${campaign.name} — ${audienceName}`,
          dailyBudgetCents: perVariantBudgetCents * groupVariants.length,
          targeting,
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
              landingPageUrl: variant.landingPageUrl ?? "https://example.com",
              imageHash: upload.imageHash,
              videoId: upload.videoId,
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
  const credentials = (await getGoogleAdsCredentials(workspaceId)) ?? undefined;
  const accessToken = credentials?.accessToken ?? null;
  const developerToken = credentials?.developerToken ?? null;

  const groups = new Map<string, CampaignVariant[]>();
  for (const variant of variants) {
    const key = variant.audienceName ?? "General Audience";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(variant);
  }
  const [firstAudienceName] = groups.keys();
  const campaignLevelTargeting = await resolveGoogleTargetingForWorkspace(workspaceId, firstAudienceName, accessToken, developerToken);

  let campaignExternalId: string;
  try {
    const container = await googleAdapter.createCampaignContainer!(
      { name: campaign.name, objective: "SEARCH", dailyBudgetCents: campaign.dailyBudgetCents, targeting: campaignLevelTargeting.campaign },
      credentials
    );
    campaignExternalId = container.externalId;
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
          targeting: targeting.adGroup,
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
              landingPageUrl: variant.landingPageUrl ?? "https://example.com",
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
  const perVariantBudget = Math.floor(campaign.dailyBudgetCents / Math.max(campaign.variants.length, 1));

  const metaVariants = campaign.variants.filter((v) => v.network === "meta");
  const googleVariants = campaign.variants.filter((v) => v.network === "google");
  const otherVariants = campaign.variants.filter((v) => v.network !== "meta" && v.network !== "google");

  for (const variant of otherVariants) {
    const adapter = adapters[variant.network];
    try {
      const result = await adapter.launchVariant({
        campaignId: campaign.id,
        variantId: variant.id,
        creative: variant.creative,
        dailyBudgetCents: perVariantBudget,
      });
      variant.externalId = result.externalId;
      variant.status = result.status;
    } catch (err) {
      variant.status = "failed";
    }
  }

  if (metaVariants.length) {
    await launchMetaHierarchy(campaign, metaVariants, workspaceId, perVariantBudget);
  }
  if (googleVariants.length) {
    await launchGoogleHierarchy(campaign, googleVariants, workspaceId, perVariantBudget);
  }

  campaign.status = campaign.variants.some((v) => v.status === "active")
    ? "active"
    : campaign.variants.some((v) => v.status === "paused")
      ? "paused"
      : "failed";
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);

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

  await adapters[variant.network].pauseVariant(variant.externalId);
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

  await adapters[variant.network].activateVariant(variant.externalId);
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

  // Budget lives on the Ad Set for hierarchy-launched (Meta) variants, not the leaf ad.
  const targetExternalId = variant.adSetExternalId ?? variant.externalId;
  await adapters[variant.network].setBudget({ externalId: targetExternalId, dailyBudgetCents });
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

export async function updateCampaign(campaignId: string, patch: { name?: string; dailyBudgetCents?: number }): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (patch.name !== undefined) campaign.name = patch.name;
  if (patch.dailyBudgetCents !== undefined) campaign.dailyBudgetCents = patch.dailyBudgetCents;
  campaign.updatedAt = new Date().toISOString();
  await saveCampaign(campaign);
  return campaign;
}

export { adapters };
