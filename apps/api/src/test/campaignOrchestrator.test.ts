import { test, after } from "node:test";
import assert from "node:assert";
import { prisma } from "../db/prisma.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

// This file's tests assert mock-mode ("safety default: paused") adapter behavior — real
// live credentials sitting in .env (e.g. for a real manual Meta-ads test) must not leak
// in here, or these calls hit the real Graph API with fake test data and fail unpredictably
// instead of exercising the mock path. Cleared before the first import of
// campaignOrchestrator.js (which imports metaAdapter.js/googleAdapter.js/tiktokAdapter.js —
// each reads its live-credential env vars once, at module load time).
for (const key of [
  "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID",
  "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_ACCESS_TOKEN",
  "TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID",
]) delete process.env[key];

const {
  buildCampaignFromStrategy,
  launchCampaign,
  pauseVariant,
  reallocateBudget,
  activateVariant,
  applyCreativeMedia,
} = await import("../modules/orchestrator/campaignOrchestrator.js");

// launchCampaign publishes "campaign.launched" via infra/eventBus.js, which is Redis
// Streams-backed (see redisStreamEventBus.ts) — that opens a real connection on this
// file's first launchCampaign call, same class of "open handle hangs node --test after
// the last test finishes" issue as metaLeadWebhook.test.ts's queue imports.
after(disconnectTestInfra);

// Setup helper to insert strategy
async function seedTestStrategy(id: string, businessId: string) {
  const strategyData = {
    id,
    businessId,
    summary: "Test strategy overview",
    recommendedNetworks: ["meta", "google", "tiktok"],
    budgetSplit: { meta: 0.34, google: 0.33, tiktok: 0.33 },
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
  assert.strictEqual(campaign.variants.length, 6, "Should generate 6 variants (3 networks x 2 creatives)");

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
  // Meta and Google now launch through their real object-graph hierarchy, paused by
  // default (safety default — see launchMetaHierarchy/launchGoogleHierarchy); only
  // TikTok's flat mock path still launches "active" today, so the campaign is "active"
  // overall because at least one variant is.
  assert.strictEqual(launched.status, "active", "Campaign status should change to active (TikTok variant still launches active)");
  assert.ok(launched.variants.every(v => v.externalId), "All variants should be assigned external IDs");

  // Pause a variant
  const targetVariant = launched.variants[0];
  const pausedCampaign = await pauseVariant(launched.id, targetVariant.id);
  const pausedVariant = pausedCampaign.variants.find(v => v.id === targetVariant.id);

  assert.strictEqual(pausedVariant?.status, "paused", "Target variant should change to paused");
});

test("Campaign Orchestrator - Meta and Google variants launch through their hierarchy paths as paused (mock mode)", async () => {
  const strategyId = `strat_test_${Date.now()}`;
  const businessId = "biz_test_1";
  await seedTestStrategy(strategyId, businessId);

  const campaignDraft = await buildCampaignFromStrategy(strategyId, "Hierarchy Test Campaign", 30000);
  const launched = await launchCampaign(campaignDraft.id, "demo");

  const metaVariants = launched.variants.filter(v => v.network === "meta");
  const googleVariants = launched.variants.filter(v => v.network === "google");
  assert.ok(metaVariants.length > 0, "Test strategy should produce at least one meta variant");
  assert.ok(googleVariants.length > 0, "Test strategy should produce at least one google variant");

  for (const variant of [...metaVariants, ...googleVariants]) {
    assert.strictEqual(variant.status, "paused", `${variant.network} variants should launch paused by default (safety default)`);
    assert.ok(variant.externalId, `${variant.network} variant should get a mock ad id`);
    assert.ok(variant.adSetExternalId, `${variant.network} variant should be attached to a mock ad set/ad group id`);
  }

  const tiktokVariants = launched.variants.filter(v => v.network === "tiktok");
  assert.ok(tiktokVariants.every(v => v.status === "active"), "TikTok keeps the existing flat mock behavior (active) until it gets the same hierarchy depth");
  assert.strictEqual(launched.status, "active", "Campaign is active overall since the TikTok variant is active");
});

test("Campaign Orchestrator - activateVariant flips a launched Meta variant to active", async () => {
  const strategyId = `strat_test_${Date.now()}`;
  const businessId = "biz_test_1";
  await seedTestStrategy(strategyId, businessId);

  const campaignDraft = await buildCampaignFromStrategy(strategyId, "Activate Test Campaign", 30000);
  const launched = await launchCampaign(campaignDraft.id, "demo");
  const metaVariant = launched.variants.find(v => v.network === "meta")!;

  const activated = await activateVariant(launched.id, metaVariant.id);
  const activatedVariant = activated.variants.find(v => v.id === metaVariant.id);
  assert.strictEqual(activatedVariant?.status, "active");
});

test("Campaign Orchestrator - applyCreativeMedia attaches generated image/video to variants lacking one", async () => {
  const strategyId = `strat_test_${Date.now()}`;
  const businessId = "biz_test_1";
  await seedTestStrategy(strategyId, businessId);

  const campaignDraft = await buildCampaignFromStrategy(strategyId, "Media Test Campaign", 10000);
  const updated = await applyCreativeMedia(campaignDraft.id, { imageUrl: "/objects/demo/hero.png" });

  assert.ok(updated.variants.every(v => v.creative.imageUrl === "/objects/demo/hero.png"));
});
