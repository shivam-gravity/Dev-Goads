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

test("Campaign Orchestrator - buildCampaignFromStrategy threads the chosen objective onto the campaign", async () => {
  const strategyId = `strat_obj_${Date.now()}`;
  const businessId = "biz_test_obj";
  await seedTestStrategy(strategyId, businessId);

  const withObjective = await buildCampaignFromStrategy(strategyId, "Objective Campaign", 10000, "OUTCOME_LEADS");
  assert.strictEqual(withObjective.objective, "OUTCOME_LEADS", "objective should be stamped onto the campaign");

  // Omitting the objective leaves it undefined (launch falls back to the historical default).
  const withoutObjective = await buildCampaignFromStrategy(strategyId, "No Objective Campaign", 10000);
  assert.strictEqual(withoutObjective.objective, undefined, "objective should be undefined when not provided");
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

test("Campaign Orchestrator - buildCampaignFromStrategy applies each network's real copy limits to its own variant, not one shared truncation", async () => {
  const strategyId = `strat_test_${Date.now()}`;
  const businessId = "biz_test_1";
  const longHeadline = "This headline is written to be much longer than any single ad network's real character limit";
  const longBody = "This is a deliberately long piece of ad body copy, written to run well past even Meta's 125-character primary-text allowance so every network's truncation can be verified independently of the others in this same test.";

  await prisma.strategy.upsert({
    where: { id: strategyId },
    create: {
      id: strategyId,
      businessId,
      data: {
        id: strategyId,
        businessId,
        summary: "Test strategy overview",
        recommendedNetworks: ["meta", "google", "tiktok"],
        budgetSplit: { meta: 0.34, google: 0.33, tiktok: 0.33 },
        audiences: ["Custom Lookalike"],
        creatives: [{ headline: longHeadline, body: longBody, callToAction: "Learn More" }],
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date(),
    },
    update: {},
  });

  const campaign = await buildCampaignFromStrategy(strategyId, "Copy Limits Test Campaign", 10000);

  const meta = campaign.variants.find((v) => v.network === "meta")!;
  const google = campaign.variants.find((v) => v.network === "google")!;
  const tiktok = campaign.variants.find((v) => v.network === "tiktok")!;

  assert.ok(meta.creative.headline.length <= 40, `meta headline should be <= 40 chars, got ${meta.creative.headline.length}`);
  assert.ok(google.creative.headline.length <= 30, `google headline should be <= 30 chars, got ${google.creative.headline.length}`);
  assert.ok(tiktok.creative.headline.length <= 100, `tiktok headline should be <= 100 chars, got ${tiktok.creative.headline.length}`);
  assert.notStrictEqual(meta.creative.headline, google.creative.headline, "the same source headline must be truncated differently per network, not shared verbatim");

  assert.ok(meta.creative.body.length <= 125);
  assert.ok(google.creative.body.length <= 90);
  assert.ok(tiktok.creative.body.length <= 100);
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
