import { test } from "node:test";
import assert from "node:assert";
import { prisma } from "../db/prisma.js";
import {
  buildCampaignFromStrategy,
  launchCampaign,
  pauseVariant,
  reallocateBudget
} from "../modules/orchestrator/campaignOrchestrator.js";

// Setup helper to insert strategy
async function seedTestStrategy(id: string, businessId: string) {
  const strategyData = {
    id,
    businessId,
    summary: "Test strategy overview",
    recommendedNetworks: ["meta", "google"],
    budgetSplit: { meta: 0.5, google: 0.5 },
    audiences: ["Custom Lookalike"],
    creatives: [
      { headline: "Headline 1", body: "Body 1", callToAction: "Learn More" },
      { headline: "Headline 2", body: "Body 2", callToAction: "Shop Now" }
    ],
    createdAt: new Date().toISOString()
  };

  await prisma.strategy.upsert({
    where: { id },
    create: { id, businessId, data: strategyData, createdAt: new Date(strategyData.createdAt) },
    update: { data: strategyData },
  });
}

test("Campaign Orchestrator - buildCampaignFromStrategy drafting", async () => {
  const strategyId = `strat_test_${Date.now()}`;
  const businessId = "biz_test_1";
  await seedTestStrategy(strategyId, businessId);

  const campaign = await buildCampaignFromStrategy(strategyId, "Test Promo Campaign", 10000);

  assert.strictEqual(campaign.name, "Test Promo Campaign");
  assert.strictEqual(campaign.status, "draft");
  assert.strictEqual(campaign.dailyBudgetCents, 10000);
  assert.strictEqual(campaign.variants.length, 4, "Should generate 4 variants (2 networks x 2 creatives)");

  const googleVariants = campaign.variants.filter(v => v.network === "google");
  assert.strictEqual(googleVariants.length, 2, "Should have 2 Google variants");
});

test("Campaign Orchestrator - launchCampaign and pauseVariant execution flow", async () => {
  const strategyId = `strat_test_${Date.now()}`;
  const businessId = "biz_test_1";
  await seedTestStrategy(strategyId, businessId);

  const campaignDraft = await buildCampaignFromStrategy(strategyId, "Launch Test Campaign", 20000);

  // Launch campaign
  const launched = await launchCampaign(campaignDraft.id);
  assert.strictEqual(launched.status, "active", "Campaign status should change to active");
  assert.ok(launched.variants.every(v => v.externalId), "All variants should be assigned external IDs");

  // Pause a variant
  const targetVariant = launched.variants[0];
  const pausedCampaign = await pauseVariant(launched.id, targetVariant.id);
  const pausedVariant = pausedCampaign.variants.find(v => v.id === targetVariant.id);

  assert.strictEqual(pausedVariant?.status, "paused", "Target variant should change to paused");
});
