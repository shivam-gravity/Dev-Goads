import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { metaAdapter } from "../adapters/metaAdapter.js";
import { googleAdapter } from "../adapters/googleAdapter.js";
import { tiktokAdapter } from "../adapters/tiktokAdapter.js";
import type { AdAdapter } from "../adapters/AdAdapter.js";
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

const adapters: Record<AdNetwork, AdAdapter> = {
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

/** Launches every draft variant on its target network via the matching adapter. */
export async function launchCampaign(campaignId: string): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  campaign.status = "launching";
  const perVariantBudget = Math.floor(campaign.dailyBudgetCents / Math.max(campaign.variants.length, 1));

  for (const variant of campaign.variants) {
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

  campaign.status = campaign.variants.some((v) => v.status === "active") ? "active" : "failed";
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

export async function reallocateBudget(campaignId: string, variantId: string, dailyBudgetCents: number): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const variant = campaign.variants.find((v) => v.id === variantId);
  if (!variant || !variant.externalId) throw new Error(`Variant ${variantId} not launched`);

  await adapters[variant.network].setBudget({ externalId: variant.externalId, dailyBudgetCents });
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
