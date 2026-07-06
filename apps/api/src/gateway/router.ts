import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "./asyncHandler.js";
import { sendError } from "./errorResponse.js";
import { objectStorage } from "../infra/objectStorage.js";
import { proxyTo } from "./proxy.js";
import { logger } from "../modules/logger/logger.js";

// Generic ceiling for ad-spend fields — prevents an obviously-wrong value (e.g. a
// misplaced decimal) from being accepted with no upper bound. Adjust per business need.
const MAX_BUDGET_CENTS = 100_000_000; // $1,000,000
import { createBusiness, getBusiness, listBusinesses, updateBusiness } from "../modules/business/businessService.js";
import { generateStrategy, getStrategy, listStrategiesForBusiness } from "../modules/strategy/strategyEngine.js";
import { getCampaignTrend } from "../modules/analytics/analyticsService.js";
import { scrapeUrl } from "../modules/onboarding/scraper.js";
import { analyzeAudience, analyzeProduct, runDeepResearch } from "../modules/onboarding/analysis.js";
import { issueDemoToken } from "./middleware/auth.js";
import {
  listCreatives,
  getCreative,
  createCreative,
  deleteCreative,
  generateCreativeVariations,
} from "../modules/orchestrator/creativesService.js";
import { getAnalyticsSummary, getAudienceSuggestions } from "../modules/analytics/analyticsService.js";
import { getAdInsights } from "../modules/adInsights/adInsightsService.js";
import { chatWithStrategist } from "../modules/strategist/strategistService.js";

// Extracted services (roadmap Phase 2) — routes below are proxied, not handled locally.
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
const CAMPAIGN_SERVICE_URL = process.env.CAMPAIGN_SERVICE_URL ?? "http://localhost:4002";
const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ?? "http://localhost:4003";

import { listNotifications, markRead, markAllRead, unreadCount, seedDemoNotifications, createNotification } from "../modules/notifications/notificationService.js";
import { listAssets, createAsset, deleteAsset, updateAssetTags, seedDemoAssets } from "../modules/assets/assetService.js";
import { listInsights, dismissInsight, generateInsights, seedDemoInsights } from "../modules/insights/insightService.js";
import { getOrCreateIntegrations, connectIntegration, disconnectIntegration, updateIntegrationSettings } from "../modules/integrations/integrationService.js";
import { getProductCatalog } from "../modules/integrations/productCatalogService.js";
import {
  listDrafts, createDraft, updateDraft, publishDraft, deleteDraft, scheduleDraft,
  listAdSets, createAdSet, listAds, createAd, updateAd, seedDemoDrafts,
} from "../modules/drafts/draftsService.js";

export const router = Router();

/* ═══════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════ */

router.post("/auth/demo-token", (req, res) => {
  const subject = typeof req.body?.subject === "string" ? req.body.subject : "demo-user";
  res.json({ token: issueDemoToken(subject) });
});

const authProxy = proxyTo(AUTH_SERVICE_URL);
router.post("/auth/register", authProxy);
router.post("/auth/login", authProxy);
router.post("/auth/google", authProxy);
router.get("/auth/me", authProxy);

/* ═══════════════════════════════════════════════
   WORKSPACES — extracted to auth-service (roadmap Phase 2). Workspace-scoped
   sub-resources below this block (notifications/assets/insights/integrations/
   drafts) stay gateway-side; only account/membership CRUD moved.
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id", authProxy);
router.patch("/workspaces/:id", authProxy);
router.get("/workspaces/:id/members", authProxy);
router.post("/workspaces/:id/members/invite", authProxy);
router.patch("/workspaces/members/:memberId/role", authProxy);
router.delete("/workspaces/members/:memberId", authProxy);

/* ═══════════════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/notifications", asyncHandler(async (req, res) => {
  await seedDemoNotifications(req.params.id);
  res.json(await listNotifications(req.params.id));
}));

router.get("/workspaces/:id/notifications/count", asyncHandler(async (req, res) => {
  res.json({ count: await unreadCount(req.params.id) });
}));

router.patch("/notifications/:id/read", asyncHandler(async (req, res) => {
  try { res.json(await markRead(req.params.id)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

router.post("/workspaces/:id/notifications/read-all", asyncHandler(async (req, res) => {
  await markAllRead(req.params.id);
  res.status(204).send();
}));

/* ═══════════════════════════════════════════════
   ASSETS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/assets", asyncHandler(async (req, res) => {
  await seedDemoAssets(req.params.id);
  const type = req.query.type as string | undefined;
  res.json(await listAssets(req.params.id, type as any));
}));

router.post("/workspaces/:id/assets", asyncHandler(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1),
    type: z.enum(["image", "video", "logo", "font", "template"]),
    url: z.string().url(),
    thumbnailUrl: z.string().url().optional(),
    size: z.number().int().nonnegative(),
    mimeType: z.string(),
    tags: z.array(z.string()).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createAsset(req.params.id, { ...parsed.data, tags: parsed.data.tags ?? [] }));
}));

router.delete("/assets/:id", asyncHandler(async (req, res) => {
  const deleted = await deleteAsset(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
}));

router.patch("/assets/:id/tags", asyncHandler(async (req, res) => {
  const parsed = z.object({ tags: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateAssetTags(req.params.id, parsed.data.tags)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

const assetUploadSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["image", "video", "logo", "font", "template"]),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
  tags: z.array(z.string()).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

router.post("/workspaces/:id/assets/upload", asyncHandler(async (req, res) => {
  const parsed = assetUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const buffer = Buffer.from(parsed.data.dataBase64, "base64");
  const safeName = parsed.data.name.replace(/[^a-z0-9.\-_]/gi, "_");
  const key = `${req.params.id}/${randomUUID()}-${safeName}`;

  try {
    const { url } = await objectStorage.put(key, buffer, parsed.data.mimeType);
    const asset = await createAsset(req.params.id, {
      name: parsed.data.name,
      type: parsed.data.type,
      url,
      size: buffer.length,
      mimeType: parsed.data.mimeType,
      tags: parsed.data.tags ?? [],
      width: parsed.data.width,
      height: parsed.data.height,
    });
    res.status(201).json(asset);
  } catch (err) {
    logger.error("Asset upload failed", err);
    res.status(500).json({ error: "Upload failed" });
  }
}));

/* ═══════════════════════════════════════════════
   AI INSIGHTS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:workspaceId/insights", asyncHandler(async (req, res) => {
  await seedDemoInsights(req.params.workspaceId);
  res.json(await listInsights(req.params.workspaceId));
}));

router.post("/workspaces/:workspaceId/insights/generate", asyncHandler(async (req, res) => {
  const { businessId } = req.query as { businessId?: string };
  if (!businessId) return res.status(400).json({ error: "businessId query param required" });
  try {
    res.json(await generateInsights(req.params.workspaceId, businessId));
  } catch (err) {
    sendError(res, err, 502, "Insight generation failed");
  }
}));

router.patch("/insights/:id/dismiss", asyncHandler(async (req, res) => {
  try { res.json(await dismissInsight(req.params.id)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

/* ═══════════════════════════════════════════════
   INTEGRATIONS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/integrations", asyncHandler(async (req, res) => res.json(await getOrCreateIntegrations(req.params.id))));

router.post("/workspaces/:id/integrations/:platform/connect", asyncHandler(async (req, res) => {
  const platform = req.params.platform as any;
  const { accountName } = req.body;
  try {
    res.json(await connectIntegration(req.params.id, platform, accountName ?? "My Ad Account"));
  } catch (err) {
    sendError(res, err, 400, "Connect failed");
  }
}));

router.post("/workspaces/:id/integrations/:platform/disconnect", asyncHandler(async (req, res) => {
  try { res.json(await disconnectIntegration(req.params.id, req.params.platform as any)); }
  catch (err) { sendError(res, err, 400, "Disconnect failed"); }
}));

router.patch("/workspaces/:id/integrations/:platform/settings", asyncHandler(async (req, res) => {
  try { res.json(await updateIntegrationSettings(req.params.id, req.params.platform as any, req.body ?? {})); }
  catch (err) { sendError(res, err, 400, "Settings update failed"); }
}));

const catalogSourceSchema = z.enum(["all", "shopify", "facebook", "google", "woocommerce"]);
router.get("/workspaces/:id/products", asyncHandler(async (req, res) => {
  const parsed = catalogSourceSchema.safeParse(req.query.source ?? "all");
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await getProductCatalog(req.params.id, parsed.data));
}));

/* ═══════════════════════════════════════════════
   DRAFTS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/drafts", asyncHandler(async (req, res) => {
  await seedDemoDrafts(req.params.id);
  res.json(await listDrafts(req.params.id));
}));

router.post("/workspaces/:id/drafts", asyncHandler(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1),
    type: z.enum(["campaign", "ad_set", "ad"]),
    data: z.record(z.unknown()),
    aiRecommendation: z.string().optional(),
    score: z.number().optional(),
    scheduledAt: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createDraft(req.params.id, parsed.data));
}));

router.patch("/drafts/:id", asyncHandler(async (req, res) => {
  try { res.json(await updateDraft(req.params.id, req.body)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

router.post("/drafts/:id/publish", asyncHandler(async (req, res) => {
  try { res.json(await publishDraft(req.params.id)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

router.post("/drafts/:id/schedule", asyncHandler(async (req, res) => {
  const { scheduledAt } = req.body;
  if (!scheduledAt) return res.status(400).json({ error: "scheduledAt required" });
  try { res.json(await scheduleDraft(req.params.id, scheduledAt)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

router.delete("/drafts/:id", asyncHandler(async (req, res) => {
  const deleted = await deleteDraft(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
}));

/* ═══════════════════════════════════════════════
   AD SETS & ADS
   ═══════════════════════════════════════════════ */

router.get("/campaigns/:id/ad-sets", asyncHandler(async (req, res) => res.json(await listAdSets(req.params.id))));

router.post("/campaigns/:id/ad-sets", asyncHandler(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1),
    status: z.enum(["active", "paused", "draft"]).default("draft"),
    dailyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS),
    targeting: z.record(z.unknown()).default({}),
    placements: z.array(z.string()).default([]),
    bidStrategy: z.string().default("lowest_cost"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createAdSet(req.params.id, parsed.data));
}));

router.get("/ad-sets/:id/ads", asyncHandler(async (req, res) => res.json(await listAds(req.params.id))));

router.post("/ad-sets/:id/ads", asyncHandler(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1),
    status: z.enum(["active", "paused", "draft", "rejected"]).default("draft"),
    creative: z.object({
      headline: z.string(),
      body: z.string(),
      callToAction: z.string(),
      imageUrl: z.string().optional(),
    }),
    format: z.enum(["single_image", "carousel", "video", "collection"]).default("single_image"),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createAd(req.params.id, parsed.data));
}));

router.patch("/ads/:id", asyncHandler(async (req, res) => {
  try { res.json(await updateAd(req.params.id, req.body)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

/* ═══════════════════════════════════════════════
   BUSINESSES (existing)
   ═══════════════════════════════════════════════ */

const businessSchema = z.object({
  name: z.string().trim().min(1),
  website: z.string().url().optional(),
  industry: z.string().trim().min(1),
  monthlyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS),
  goals: z.array(z.string()).min(1),
  targetAudience: z.string().optional(),
});

router.post("/businesses", asyncHandler(async (req, res) => {
  const parsed = businessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createBusiness(parsed.data));
}));

router.get("/businesses", asyncHandler(async (_req, res) => res.json(await listBusinesses())));

router.get("/businesses/:id", asyncHandler(async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Not found" });
  res.json(business);
}));

router.patch("/businesses/:id", asyncHandler(async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Not found" });
  const parsed = businessSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await updateBusiness(req.params.id, parsed.data));
}));

router.post("/businesses/:id/strategies", asyncHandler(async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Business not found" });
  try {
    const strategy = await generateStrategy(business);
    res.status(201).json(strategy);
  } catch (err) {
    sendError(res, err, 502, "Strategy generation failed");
  }
}));

router.get("/businesses/:id/strategies", asyncHandler(async (req, res) => res.json(await listStrategiesForBusiness(req.params.id))));
router.get("/strategies/:id", asyncHandler(async (req, res) => {
  const strategy = await getStrategy(req.params.id);
  if (!strategy) return res.status(404).json({ error: "Not found" });
  res.json(strategy);
}));

// Analytics
router.get("/businesses/:id/analytics/summary", asyncHandler(async (req, res) => {
  const period = (req.query.period as "all" | "month" | "week") ?? "all";
  res.json(await getAnalyticsSummary(req.params.id, period));
}));

router.get("/businesses/:id/audience-suggestions", asyncHandler(async (req, res) => {
  try { res.json(await getAudienceSuggestions(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Audience suggestion failed"); }
}));

router.get("/businesses/:id/ad-insights", asyncHandler(async (req, res) => {
  const parsed = z.enum(["meta", "google", "tiktok", "bing"]).safeParse(req.query.network ?? "meta");
  if (!parsed.success) return res.status(400).json({ error: "Invalid network" });
  res.json(await getAdInsights(req.params.id, parsed.data));
}));

const strategistChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })).min(1),
});
router.post("/businesses/:id/strategist/chat", asyncHandler(async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Business not found" });
  const parsed = strategistChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const reply = await chatWithStrategist(req.params.id, parsed.data.messages);
    res.json({ reply });
  } catch (err) {
    sendError(res, err, 502, "Strategist chat failed");
  }
}));

// Creatives
const creativeSchema = z.object({
  headline: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(500),
  callToAction: z.string().trim().min(1).max(50),
  format: z.enum(["text", "image", "video"]).optional(),
  tags: z.array(z.string()).optional(),
});

router.get("/businesses/:id/creatives", asyncHandler(async (req, res) => res.json(await listCreatives(req.params.id))));
router.post("/businesses/:id/creatives", asyncHandler(async (req, res) => {
  const parsed = creativeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createCreative(req.params.id, parsed.data));
}));
router.get("/creatives/:id", asyncHandler(async (req, res) => {
  const creative = await getCreative(req.params.id);
  if (!creative) return res.status(404).json({ error: "Not found" });
  res.json(creative);
}));
router.delete("/creatives/:id", asyncHandler(async (req, res) => {
  const deleted = await deleteCreative(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
}));
router.post("/creatives/variations", asyncHandler(async (req, res) => {
  const parsed = z.object({ headline: z.string(), body: z.string(), callToAction: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await generateCreativeVariations(parsed.data)); }
  catch (err) { sendError(res, err, 502, "Variation generation failed"); }
}));

// Campaigns — extracted to campaign-service (roadmap Phase 2). /campaigns/:id/trend
// stays gateway-side since it's an analytics read (analyticsService.getCampaignTrend),
// not core campaign CRUD/orchestration.
const campaignProxy = proxyTo(CAMPAIGN_SERVICE_URL);
router.post("/campaigns", campaignProxy);
router.get("/businesses/:id/campaigns", campaignProxy);
router.get("/campaigns/:id", campaignProxy);
router.patch("/campaigns/:id", campaignProxy);
router.post("/campaigns/:id/launch", campaignProxy);
router.post("/campaigns/:id/variants/:variantId/pause", campaignProxy);
router.post("/campaigns/:id/ingest", campaignProxy);
router.get("/campaigns/:id/performance", campaignProxy);
router.get("/campaigns/:id/trend", asyncHandler(async (req, res) => res.json(await getCampaignTrend(req.params.id))));
router.post("/campaigns/:id/optimize", campaignProxy);

// Billing — extracted to campaign-service (roadmap Phase 2).
router.post("/businesses/:id/invoices", campaignProxy);
router.get("/businesses/:id/invoices", campaignProxy);

// Onboarding
const scrapeSchema = z.object({ url: z.string().min(1) });
router.post("/onboarding/scrape", asyncHandler(async (req, res) => {
  const parsed = scrapeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await scrapeUrl(parsed.data.url)); }
  catch (err) { sendError(res, err, 422, "Failed to scrape URL"); }
}));

const productAnalysisSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
  excerpt: z.string(),
  images: z.array(z.string()).default([]),
  crawledPages: z.array(z.string()).default([]),
});
router.post("/onboarding/analyze-product", asyncHandler(async (req, res) => {
  const parsed = productAnalysisSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await analyzeProduct(parsed.data)); }
  catch (err) { sendError(res, err, 502, "Product analysis failed"); }
}));

const audienceAnalysisSchema = z.object({
  site: productAnalysisSchema,
  product: z.object({ productName: z.string(), category: z.string(), summary: z.string(), valueProposition: z.string(), keyFeatures: z.array(z.string()) }),
});
router.post("/onboarding/analyze-audience", asyncHandler(async (req, res) => {
  const parsed = audienceAnalysisSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await analyzeAudience(parsed.data.site, parsed.data.product)); }
  catch (err) { sendError(res, err, 502, "Audience analysis failed"); }
}));

router.post("/onboarding/deep-research", asyncHandler(async (req, res) => {
  const parsed = scrapeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await runDeepResearch(parsed.data.url)); }
  catch (err) { sendError(res, err, 422, "Deep research failed"); }
}));

/* ═══════════════════════════════════════════════
   PRODUCT IMPORT — extracted to scraper-service. Product URL -> Playwright ->
   images/metadata -> LLM, distinct from the onboarding scraper above (which
   crawls a whole business site with fetch+cheerio rather than a single
   JS-rendered product page).
   ═══════════════════════════════════════════════ */
const scraperProxy = proxyTo(SCRAPER_SERVICE_URL);
router.post("/products/scrape", scraperProxy);
router.post("/products/import", scraperProxy);

// Consistent JSON 404 for anything under /api that didn't match a route above,
// instead of Express's default HTML error page.
router.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
