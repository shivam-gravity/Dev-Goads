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
import { generateStrategy, getStrategy, listStrategiesForBusiness, createStrategyFromResearch } from "../modules/strategy/strategyEngine.js";
import { getCampaignTrend } from "../modules/analytics/analyticsService.js";
import { scrapeUrl } from "../modules/onboarding/scraper.js";
import { analyzeAudience, analyzeProduct, runDeepResearch } from "../modules/onboarding/analysis.js";
import { findCachedSession, cloneSessionFromCache, createResearchSession, getResearchSession } from "../modules/onboarding/researchSessionService.js";
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
import { getOrCreateIntegrations, connectIntegration, disconnectIntegration, updateIntegrationSettings, getMetaCredentials, sanitizeIntegration, setMetaManualConnection, setGoogleManualConnection } from "../modules/integrations/integrationService.js";
import { listAdAccounts as listMetaAdAccountsGraph, listPages as listMetaPagesGraph, listInstagramAccounts as listMetaInstagramAccountsGraph, listPixels as listMetaPixelsGraph } from "../modules/integrations/metaOAuth.js";
import { listAccessibleCustomers as listGoogleCustomersApi, listConversionActions as listGoogleConversionActionsApi } from "../modules/integrations/googleOAuth.js";
import { getProductCatalog } from "../modules/integrations/productCatalogService.js";
import { createGenerationJob, getGenerationJob } from "../modules/generation/generationJobService.js";
import { getCrmWebhookConfig, setCrmWebhookConfig, clearCrmWebhookConfig } from "../modules/crm/crmWebhookService.js";
import { creativeGenerationQueue, researchSessionQueue } from "../infra/queue.js";
import {
  listSavedAudiences,
  createSavedAudience,
  updateSavedAudience,
  deleteSavedAudience,
  getSavedAudience,
} from "../modules/audience/savedAudienceService.js";
import { buildMetaTargetingSpec, fetchMetaReachEstimate, estimateReachHeuristic } from "../modules/adapters/metaTargetingMapper.js";
import {
  listDrafts, createDraft, updateDraft, publishDraft, deleteDraft, scheduleDraft,
  listAdSets, createAdSet, listAds, createAd, updateAd, seedDemoDrafts,
} from "../modules/drafts/draftsService.js";
import { listSupportTickets, createSupportTicket } from "../modules/support/supportTicketService.js";
import { getNotificationPreferences, setNotificationPreferences } from "../modules/notifications/notificationPreferenceService.js";
import { getRbacMatrix, setRbacMatrix } from "../modules/admin/rbacService.js";
import {
  listDeveloperWebhooks, createDeveloperWebhook, deleteDeveloperWebhook,
  getOrCreateApiKey, regenerateApiKey,
} from "../modules/admin/developerPortalService.js";
import { getPaymentMethod, setPaymentMethod, validatePaymentMethodInput } from "../modules/billing/paymentMethodService.js";
import { listAutomationRules, createAutomationRule, deleteAutomationRule } from "../modules/automation/automationRuleService.js";
import { getOptimizationGoal, setOptimizationGoal } from "../modules/optimization/optimizationGoalService.js";

export const router = Router();

// Register/login/google are mounted unauthenticated, ahead of requireAuth, in index.ts
// (see authEntryRouter below) — a client has no bearer token yet when calling them, so
// gating them behind requireAuth would be a chicken-and-egg 401 in production.
export const authEntryRouter = Router();
const authProxy = proxyTo(AUTH_SERVICE_URL);
authEntryRouter.post("/auth/register", authProxy);
authEntryRouter.post("/auth/login", authProxy);
authEntryRouter.post("/auth/google", authProxy);

/* ═══════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════ */

router.get("/auth/me", authProxy);
router.patch("/auth/me", authProxy);

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
  if (!(await getBusiness(businessId))) return res.status(404).json({ error: "Business not found" });
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

router.get("/workspaces/:id/integrations", asyncHandler(async (req, res) => res.json((await getOrCreateIntegrations(req.params.id)).map(sanitizeIntegration))));

const INTEGRATION_PLATFORMS = ["meta", "google", "tiktok", "shopify", "woocommerce", "pixel"] as const;

router.post("/workspaces/:id/integrations/:platform/connect", asyncHandler(async (req, res) => {
  const platform = req.params.platform as any;
  if (!INTEGRATION_PLATFORMS.includes(platform)) return res.status(400).json({ error: `Unknown platform "${platform}"` });
  const { accountName } = req.body;
  try {
    res.json(sanitizeIntegration(await connectIntegration(req.params.id, platform, accountName ?? "My Ad Account")));
  } catch (err) {
    sendError(res, err, 400, "Connect failed");
  }
}));

router.post("/workspaces/:id/integrations/:platform/disconnect", asyncHandler(async (req, res) => {
  try { res.json(sanitizeIntegration(await disconnectIntegration(req.params.id, req.params.platform as any))); }
  catch (err) { sendError(res, err, 400, "Disconnect failed"); }
}));

router.patch("/workspaces/:id/integrations/:platform/settings", asyncHandler(async (req, res) => {
  try { res.json(sanitizeIntegration(await updateIntegrationSettings(req.params.id, req.params.platform as any, req.body ?? {}))); }
  catch (err) { sendError(res, err, 400, "Settings update failed"); }
}));

const metaManualConnectSchema = z.object({
  accessToken: z.string().trim().min(1),
  adAccountId: z.string().trim().min(1),
  pageId: z.string().trim().min(1).optional(),
  pageAccessToken: z.string().trim().min(1).optional(),
});

router.post("/workspaces/:id/integrations/meta/connect-manual", asyncHandler(async (req, res) => {
  const parsed = metaManualConnectSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, parsed.error, 400, "Invalid manual connect payload");
  try {
    res.json(sanitizeIntegration(await setMetaManualConnection(req.params.id, parsed.data)));
  } catch (err) {
    sendError(res, err, 400, "Manual connect failed");
  }
}));

const googleManualConnectSchema = z.object({
  customerId: z.string().trim().min(1),
  developerToken: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  clientId: z.string().trim().min(1).optional(),
  clientSecret: z.string().trim().min(1).optional(),
  refreshToken: z.string().trim().min(1).optional(),
});

router.post("/workspaces/:id/integrations/google/connect-manual", asyncHandler(async (req, res) => {
  const parsed = googleManualConnectSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, parsed.error, 400, "Invalid manual connect payload");
  try {
    res.json(sanitizeIntegration(await setGoogleManualConnection(req.params.id, parsed.data)));
  } catch (err) {
    sendError(res, err, 400, "Manual connect failed");
  }
}));

// Full account/page/Instagram/pixel lists for the campaign builder's selector dropdowns —
// distinct from the single-account picker the OAuth callback stores (metaOAuth.ts). Falls
// back to mock data when there's no live Meta connection so the builder always has options.
router.get("/workspaces/:id/integrations/meta/ad-accounts", asyncHandler(async (req, res) => {
  try { res.json(await listMetaAdAccountsGraph(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Meta ad accounts"); }
}));

router.get("/workspaces/:id/integrations/meta/pages", asyncHandler(async (req, res) => {
  try { res.json(await listMetaPagesGraph(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Meta pages"); }
}));

router.get("/workspaces/:id/integrations/meta/pages/:pageId/instagram-accounts", asyncHandler(async (req, res) => {
  try { res.json(await listMetaInstagramAccountsGraph(req.params.id, req.params.pageId)); }
  catch (err) { sendError(res, err, 502, "Failed to list Instagram accounts"); }
}));

router.get("/workspaces/:id/integrations/meta/pixels", asyncHandler(async (req, res) => {
  try { res.json(await listMetaPixelsGraph(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Meta pixels"); }
}));

router.get("/workspaces/:id/integrations/google/customers", asyncHandler(async (req, res) => {
  try { res.json(await listGoogleCustomersApi(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Google Ads customers"); }
}));

router.get("/workspaces/:id/integrations/google/conversion-actions", asyncHandler(async (req, res) => {
  try { res.json(await listGoogleConversionActionsApi(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Google conversion actions"); }
}));

/* ═══════════════════════════════════════════════
   SAVED AUDIENCES / DEMOGRAPHIC TARGETING
   ═══════════════════════════════════════════════ */

const savedAudienceFields = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["saved", "custom", "lookalike", "interest_group"]).default("saved"),
  platform: z.enum(["meta", "google"]).nullable().optional(),
  lookalikeSourceId: z.string().nullable().optional(),
  ageMin: z.number().int().min(13).max(65),
  ageMax: z.number().int().min(13).max(65),
  gender: z.enum(["all", "male", "female"]).default("all"),
  locations: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
});

const ageRangeValid = (data: { ageMin?: number; ageMax?: number }) =>
  data.ageMin === undefined || data.ageMax === undefined || data.ageMin <= data.ageMax;
const ageRangeRefinement = { message: "ageMin must be less than or equal to ageMax", path: ["ageMax"] };

const savedAudienceSchema = savedAudienceFields.refine(ageRangeValid, ageRangeRefinement);
const savedAudienceUpdateSchema = savedAudienceFields.partial().refine(ageRangeValid, ageRangeRefinement);

router.get("/workspaces/:id/audiences", asyncHandler(async (req, res) => res.json(await listSavedAudiences(req.params.id))));

router.post("/workspaces/:id/audiences", asyncHandler(async (req, res) => {
  const parsed = savedAudienceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createSavedAudience(req.params.id, parsed.data));
}));

router.patch("/audiences/:id", asyncHandler(async (req, res) => {
  const parsed = savedAudienceUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateSavedAudience(req.params.id, parsed.data)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

router.delete("/audiences/:id", asyncHandler(async (req, res) => {
  const deleted = await deleteSavedAudience(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
}));

router.post("/workspaces/:id/audiences/:audienceId/reach-estimate", asyncHandler(async (req, res) => {
  const audience = await getSavedAudience(req.params.audienceId);
  if (!audience) return res.status(404).json({ error: "Not found" });

  const credentials = await getMetaCredentials(req.params.id);
  if (!credentials) return res.json(estimateReachHeuristic(audience));

  try {
    const targeting = await buildMetaTargetingSpec(credentials.accessToken, audience);
    res.json(await fetchMetaReachEstimate(credentials.accessToken, credentials.adAccountId, targeting));
  } catch (err) {
    sendError(res, err, 502, "Meta reach estimate failed");
  }
}));

const ephemeralReachEstimateSchema = z.object({
  locations: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
  ageMin: z.number().int().min(13).max(65).default(18),
  ageMax: z.number().int().min(13).max(65).default(65),
  gender: z.enum(["all", "male", "female"]).default("all"),
});

// Same reach-estimate machinery as above, but for the campaign builder's audience gauge
// where the targeting hasn't been (and may never be) saved as a SavedAudience.
router.post("/workspaces/:id/reach-estimate", asyncHandler(async (req, res) => {
  const parsed = ephemeralReachEstimateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const audience = { id: "ephemeral", workspaceId: req.params.id, name: "ephemeral", exclusions: [], createdAt: new Date().toISOString(), ...parsed.data };

  const credentials = await getMetaCredentials(req.params.id);
  if (!credentials) return res.json(estimateReachHeuristic(audience));

  try {
    const targeting = await buildMetaTargetingSpec(credentials.accessToken, audience);
    res.json(await fetchMetaReachEstimate(credentials.accessToken, credentials.adAccountId, targeting));
  } catch (err) {
    sendError(res, err, 502, "Meta reach estimate failed");
  }
}));

/* ═══════════════════════════════════════════════
   CRM OUTBOUND WEBHOOK CONFIG (Stage E)
   ═══════════════════════════════════════════════ */

const crmWebhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(1).nullable().optional(),
});

router.get("/workspaces/:id/crm-webhook", asyncHandler(async (req, res) => {
  const config = await getCrmWebhookConfig(req.params.id);
  // Never return the secret — same treatment as an OAuth token, only "is one set" matters here.
  res.json({ url: config?.url ?? null, configured: Boolean(config) });
}));

router.put("/workspaces/:id/crm-webhook", asyncHandler(async (req, res) => {
  const parsed = crmWebhookConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await setCrmWebhookConfig(req.params.id, parsed.data);
  res.status(204).send();
}));

router.delete("/workspaces/:id/crm-webhook", asyncHandler(async (req, res) => {
  await clearCrmWebhookConfig(req.params.id);
  res.status(204).send();
}));

/* ═══════════════════════════════════════════════
   AI CREATIVE GENERATION
   ═══════════════════════════════════════════════ */

const generationJobSchema = z.object({
  businessId: z.string().min(1),
  productUrl: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
  wantVideo: z.boolean().default(false),
}).refine((v) => v.productUrl || v.prompt, { message: "Either productUrl or prompt is required" });

router.post("/workspaces/:id/generation-jobs", asyncHandler(async (req, res) => {
  const parsed = generationJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const job = await createGenerationJob(req.params.id, parsed.data);
  await creativeGenerationQueue.add("generate", { jobId: job.id });
  res.status(202).json(job);
}));

router.get("/generation-jobs/:id", asyncHandler(async (req, res) => {
  const job = await getGenerationJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
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

const draftUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(["campaign", "ad_set", "ad"]).optional(),
  status: z.enum(["draft", "review", "scheduled", "published"]).optional(),
  data: z.record(z.unknown()).optional(),
  aiRecommendation: z.string().optional(),
  score: z.number().optional(),
  scheduledAt: z.string().optional(),
  publishedAt: z.string().optional(),
});

router.patch("/drafts/:id", asyncHandler(async (req, res) => {
  const parsed = draftUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateDraft(req.params.id, parsed.data)); }
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

const adUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: z.enum(["active", "paused", "draft", "rejected"]).optional(),
  creative: z.object({
    headline: z.string(),
    body: z.string(),
    callToAction: z.string(),
    imageUrl: z.string().optional(),
  }).optional(),
  format: z.enum(["single_image", "carousel", "video", "collection"]).optional(),
});

router.patch("/ads/:id", asyncHandler(async (req, res) => {
  const parsed = adUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateAd(req.params.id, parsed.data)); }
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
  brandName: z.string().trim().min(1).optional(),
  logoUrls: z.array(z.string()).max(5).optional(),
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

router.post("/businesses/:id/strategies/from-research", asyncHandler(async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Business not found" });
  const researchSessionId = typeof req.body?.researchSessionId === "string" ? req.body.researchSessionId : undefined;
  if (!researchSessionId) return res.status(400).json({ error: "researchSessionId is required" });

  const session = await getResearchSession(researchSessionId);
  if (!session || session.status !== "done" || !session.result) {
    return res.status(409).json({ error: "Research session is not complete" });
  }

  try {
    const strategy = await createStrategyFromResearch(business.id, session.result as any);
    res.status(201).json(strategy);
  } catch (err) {
    sendError(res, err, 502, "Failed to build strategy from research");
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
router.post("/campaigns/from-suggestions", campaignProxy);
router.get("/businesses/:id/campaigns", campaignProxy);
router.get("/campaigns/:id", campaignProxy);
router.patch("/campaigns/:id", campaignProxy);
router.post("/campaigns/:id/launch", campaignProxy);
router.post("/campaigns/:id/variants/:variantId/pause", campaignProxy);
router.post("/campaigns/:id/variants/:variantId/activate", campaignProxy);
router.post("/campaigns/:id/apply-creative-media", campaignProxy);
router.post("/campaigns/:id/ingest", campaignProxy);
router.get("/campaigns/:id/performance", campaignProxy);
router.get("/campaigns/:id/live-insights", campaignProxy);
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
  pagesDiscovered: z.number().default(0),
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

// Deep research sessions — the job/polling replacement for /onboarding/deep-research
// above, needed because the richer web-search-backed pipeline (marketResearch.ts) is
// too slow for one blocking request. A recently-completed session for the same URL is
// cloned instead of re-run unless ?force=true, so resubmitting doesn't re-spend real
// web searches.
const researchSessionSchema = z.object({ url: z.string().min(1), businessId: z.string().optional() });
router.post("/workspaces/:id/research-sessions", asyncHandler(async (req, res) => {
  const parsed = researchSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { url, businessId } = parsed.data;
  const workspaceId = req.params.id;
  const force = req.query.force === "true";

  try {
    if (!force) {
      const cached = await findCachedSession(workspaceId, url);
      if (cached) {
        const cloned = await cloneSessionFromCache(workspaceId, url, cached, businessId);
        return res.status(201).json(cloned);
      }
    }

    const session = await createResearchSession(workspaceId, url, businessId);
    await researchSessionQueue.add("research", { sessionId: session.id, url });
    res.status(202).json(session);
  } catch (err) {
    sendError(res, err, 422, "Failed to start research session");
  }
}));

router.get("/research-sessions/:id", asyncHandler(async (req, res) => {
  const session = await getResearchSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Research session not found" });
  res.json(session);
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

/* ═══════════════════════════════════════════════
   SUPPORT TICKETS
   ═══════════════════════════════════════════════ */

const supportTicketSchema = z.object({ subject: z.string().trim().min(1), message: z.string().trim().min(1) });

router.get("/workspaces/:id/support-tickets", asyncHandler(async (req, res) => res.json(await listSupportTickets(req.params.id))));
router.post("/workspaces/:id/support-tickets", asyncHandler(async (req, res) => {
  const parsed = supportTicketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createSupportTicket(req.params.id, parsed.data));
}));

/* ═══════════════════════════════════════════════
   NOTIFICATION PREFERENCES
   ═══════════════════════════════════════════════ */

const notificationPreferencesSchema = z.object({ emailAlerts: z.boolean(), slackAlerts: z.boolean(), digestAlerts: z.boolean() });

router.get("/workspaces/:id/notification-preferences", asyncHandler(async (req, res) => res.json(await getNotificationPreferences(req.params.id))));
router.put("/workspaces/:id/notification-preferences", asyncHandler(async (req, res) => {
  const parsed = notificationPreferencesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await setNotificationPreferences(req.params.id, parsed.data));
}));

/* ═══════════════════════════════════════════════
   RBAC ROLE MATRIX
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/rbac-matrix", asyncHandler(async (req, res) => res.json(await getRbacMatrix(req.params.id))));
router.put("/workspaces/:id/rbac-matrix", asyncHandler(async (req, res) => {
  const parsed = z.record(z.record(z.boolean())).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await setRbacMatrix(req.params.id, parsed.data));
}));

/* ═══════════════════════════════════════════════
   DEVELOPER PORTAL — webhooks & API key
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/developer/webhooks", asyncHandler(async (req, res) => res.json(await listDeveloperWebhooks(req.params.id))));
router.post("/workspaces/:id/developer/webhooks", asyncHandler(async (req, res) => {
  const parsed = z.object({ url: z.string().url(), events: z.array(z.string()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createDeveloperWebhook(req.params.id, parsed.data));
}));
router.delete("/developer/webhooks/:id", asyncHandler(async (req, res) => {
  const deleted = await deleteDeveloperWebhook(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
}));

router.get("/workspaces/:id/developer/api-key", asyncHandler(async (req, res) => res.json(await getOrCreateApiKey(req.params.id))));
router.post("/workspaces/:id/developer/api-key/regenerate", asyncHandler(async (req, res) => res.json(await regenerateApiKey(req.params.id))));

/* ═══════════════════════════════════════════════
   BILLING — payment method (mock; never stores a card number or CVC)
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/payment-method", asyncHandler(async (req, res) => res.json(await getPaymentMethod(req.params.id))));
router.put("/workspaces/:id/payment-method", asyncHandler(async (req, res) => {
  const parsed = z.object({ cardNumber: z.string().min(1), expiry: z.string().min(1), cvc: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const validationError = validatePaymentMethodInput(parsed.data);
  if (validationError) return res.status(400).json({ error: validationError });
  res.json(await setPaymentMethod(req.params.id, parsed.data));
}));

/* ═══════════════════════════════════════════════
   AUTOMATION RULES
   ═══════════════════════════════════════════════ */

const automationRuleSchema = z.object({
  name: z.string().trim().min(1),
  metric: z.string().trim().min(1),
  operator: z.enum(["gt", "lt", "eq"]),
  thresholdValue: z.number(),
  action: z.string().trim().min(1),
  actionParam: z.string().optional(),
  cooldownMinutes: z.number().int().nonnegative(),
  priority: z.enum(["low", "medium", "high"]),
});

router.get("/workspaces/:id/automation-rules", asyncHandler(async (req, res) => res.json(await listAutomationRules(req.params.id))));
router.post("/workspaces/:id/automation-rules", asyncHandler(async (req, res) => {
  const parsed = automationRuleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await createAutomationRule(req.params.id, parsed.data));
}));
router.delete("/automation-rules/:id", asyncHandler(async (req, res) => {
  const deleted = await deleteAutomationRule(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
}));

/* ═══════════════════════════════════════════════
   OPTIMIZATION GOAL (Optimize Goal page's budget/KPI section)
   ═══════════════════════════════════════════════ */

const optimizationGoalSchema = z.object({
  dailyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS),
  primaryKpi: z.string().trim().min(1),
  locations: z.array(z.string()),
});

router.get("/workspaces/:id/optimization-goal", asyncHandler(async (req, res) => res.json(await getOptimizationGoal(req.params.id))));
router.put("/workspaces/:id/optimization-goal", asyncHandler(async (req, res) => {
  const parsed = optimizationGoalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await setOptimizationGoal(req.params.id, parsed.data));
}));

// Consistent JSON 404 for anything under /api that didn't match a route above,
// instead of Express's default HTML error page.
router.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
