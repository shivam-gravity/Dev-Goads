import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";
import { metaAdapter } from "../adapters/metaAdapter.js";
import { googleAdapter } from "../adapters/googleAdapter.js";
import type { AdAdapter } from "../adapters/AdAdapter.js";
import type { AdNetwork, Campaign, CampaignVariant } from "../../types/index.js";
import { getStrategy } from "../strategy/strategyEngine.js";

const adapters: Record<AdNetwork, AdAdapter> = {
  meta: metaAdapter,
  google: googleAdapter,
};

function saveCampaign(campaign: Campaign) {
  db.prepare(
    `INSERT INTO campaigns (id, businessId, data, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`
  ).run(campaign.id, campaign.businessId, JSON.stringify(campaign), campaign.updatedAt);
}

export function getCampaign(id: string): Campaign | null {
  const row = db.prepare("SELECT data FROM campaigns WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function listCampaignsForBusiness(businessId: string): Campaign[] {
  const rows = db.prepare("SELECT data FROM campaigns WHERE businessId = ? ORDER BY updatedAt DESC").all(businessId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}

/** Builds a campaign draft from a strategy: one variant per creative x recommended network. */
export function buildCampaignFromStrategy(strategyId: string, name: string, dailyBudgetCents: number): Campaign {
  const strategy = getStrategy(strategyId);
  if (!strategy) throw new Error(`Strategy ${strategyId} not found`);

  const variants: CampaignVariant[] = strategy.creatives.flatMap((creative) =>
    strategy.recommendedNetworks.map((network) => ({
      id: randomUUID(),
      creative,
      network,
      status: "draft" as const,
    }))
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

  saveCampaign(campaign);
  return campaign;
}

/** Launches every draft variant on its target network via the matching adapter. */
export async function launchCampaign(campaignId: string): Promise<Campaign> {
  const campaign = getCampaign(campaignId);
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
  saveCampaign(campaign);
  return campaign;
}

export async function pauseVariant(campaignId: string, variantId: string): Promise<Campaign> {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const variant = campaign.variants.find((v) => v.id === variantId);
  if (!variant || !variant.externalId) throw new Error(`Variant ${variantId} not launched`);

  await adapters[variant.network].pauseVariant(variant.externalId);
  variant.status = "paused";
  campaign.updatedAt = new Date().toISOString();
  saveCampaign(campaign);
  return campaign;
}

export async function reallocateBudget(campaignId: string, variantId: string, dailyBudgetCents: number): Promise<Campaign> {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const variant = campaign.variants.find((v) => v.id === variantId);
  if (!variant || !variant.externalId) throw new Error(`Variant ${variantId} not launched`);

  await adapters[variant.network].setBudget({ externalId: variant.externalId, dailyBudgetCents });
  campaign.updatedAt = new Date().toISOString();
  saveCampaign(campaign);
  return campaign;
}

export function updateCampaign(campaignId: string, patch: { name?: string; dailyBudgetCents?: number }): Campaign {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (patch.name !== undefined) campaign.name = patch.name;
  if (patch.dailyBudgetCents !== undefined) campaign.dailyBudgetCents = patch.dailyBudgetCents;
  campaign.updatedAt = new Date().toISOString();
  saveCampaign(campaign);
  return campaign;
}

export { adapters };
