import { Router } from "express";
import { z } from "zod";
import { createBusiness, getBusiness, listBusinesses, updateBusiness } from "../modules/business/businessService.js";
import { generateStrategy, getStrategy, listStrategiesForBusiness } from "../modules/strategy/strategyEngine.js";
import {
  buildCampaignFromStrategy,
  launchCampaign,
  listCampaignsForBusiness,
  getCampaign,
  pauseVariant,
  updateCampaign,
} from "../modules/orchestrator/campaignOrchestrator.js";
import { ingestCampaignMetrics, normalizePerformance } from "../modules/pipeline/performancePipeline.js";
import { runOptimizationPass } from "../modules/optimization/optimizationEngine.js";
import { generateInvoice, listInvoices } from "../modules/billing/billingEngine.js";
import { scrapeUrl } from "../modules/onboarding/scraper.js";
import { analyzeAudience, analyzeProduct } from "../modules/onboarding/analysis.js";
import { issueDemoToken } from "./middleware/auth.js";
import {
  listCreatives,
  getCreative,
  createCreative,
  deleteCreative,
  generateCreativeVariations,
} from "../modules/orchestrator/creativesService.js";
import { getAnalyticsSummary, getCampaignTrend, getAudienceSuggestions } from "../modules/analytics/analyticsService.js";

// New module imports
import { register, login, googleAuth, getUserById, verifyToken } from "../modules/auth/authService.js";
import { getWorkspace, listWorkspacesForUser, updateWorkspace, listMembers, inviteMember, updateMemberRole, removeMember } from "../modules/workspace/workspaceService.js";
import { listNotifications, markRead, markAllRead, unreadCount, seedDemoNotifications, createNotification } from "../modules/notifications/notificationService.js";
import { listAssets, createAsset, deleteAsset, updateAssetTags, seedDemoAssets } from "../modules/assets/assetService.js";
import { listInsights, dismissInsight, generateInsights, seedDemoInsights } from "../modules/insights/insightService.js";
import { getOrCreateIntegrations, connectIntegration, disconnectIntegration, updateIntegrationSettings } from "../modules/integrations/integrationService.js";
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

router.post("/auth/register", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = register(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
});

router.post("/auth/login", (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(login(parsed.data.email, parsed.data.password));
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
});

router.post("/auth/google", (req, res) => {
  // Mock Google OAuth — in production, verify the Google ID token
  const parsed = z.object({ name: z.string(), email: z.string().email(), googleId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(googleAuth(parsed.data.name, parsed.data.email, parsed.data.googleId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Google auth failed" });
  }
});

router.get("/auth/me", (req, res) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing auth" });
  try {
    const { userId } = verifyToken(header.replace(/^Bearer\s+/i, ""));
    const user = getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

/* ═══════════════════════════════════════════════
   WORKSPACES
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "Workspace not found" });
  res.json(ws);
});

router.patch("/workspaces/:id", (req, res) => {
  const parsed = z.object({ name: z.string().optional(), logoUrl: z.string().optional(), timezone: z.string().optional(), plan: z.enum(["starter", "pro", "agency"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(updateWorkspace(req.params.id, parsed.data)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" }); }
});

router.get("/workspaces/:id/members", (req, res) => res.json(listMembers(req.params.id)));

router.post("/workspaces/:id/members/invite", (req, res) => {
  const parsed = z.object({ email: z.string().email(), role: z.enum(["admin", "member", "viewer"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.status(201).json(inviteMember(req.params.id, parsed.data.email, parsed.data.role)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Invite failed" }); }
});

router.patch("/workspaces/members/:memberId/role", (req, res) => {
  const parsed = z.object({ role: z.enum(["admin", "member", "viewer"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(updateMemberRole(req.params.memberId, parsed.data.role)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" }); }
});

router.delete("/workspaces/members/:memberId", (req, res) => {
  removeMember(req.params.memberId);
  res.status(204).send();
});

/* ═══════════════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/notifications", (req, res) => {
  seedDemoNotifications(req.params.id);
  res.json(listNotifications(req.params.id));
});

router.get("/workspaces/:id/notifications/count", (req, res) => {
  res.json({ count: unreadCount(req.params.id) });
});

router.patch("/notifications/:id/read", (req, res) => {
  try { res.json(markRead(req.params.id)); }
  catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : "Not found" }); }
});

router.post("/workspaces/:id/notifications/read-all", (req, res) => {
  markAllRead(req.params.id);
  res.status(204).send();
});

/* ═══════════════════════════════════════════════
   ASSETS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/assets", (req, res) => {
  seedDemoAssets(req.params.id);
  const type = req.query.type as string | undefined;
  res.json(listAssets(req.params.id, type as any));
});

router.post("/workspaces/:id/assets", (req, res) => {
  const parsed = z.object({
    name: z.string().min(1),
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
  res.status(201).json(createAsset(req.params.id, { ...parsed.data, tags: parsed.data.tags ?? [] }));
});

router.delete("/assets/:id", (req, res) => {
  const deleted = deleteAsset(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

router.patch("/assets/:id/tags", (req, res) => {
  const parsed = z.object({ tags: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(updateAssetTags(req.params.id, parsed.data.tags)); }
  catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : "Not found" }); }
});

/* ═══════════════════════════════════════════════
   AI INSIGHTS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:workspaceId/insights", (req, res) => {
  seedDemoInsights(req.params.workspaceId);
  res.json(listInsights(req.params.workspaceId));
});

router.post("/workspaces/:workspaceId/insights/generate", async (req, res) => {
  const { businessId } = req.query as { businessId?: string };
  if (!businessId) return res.status(400).json({ error: "businessId query param required" });
  try {
    res.json(await generateInsights(req.params.workspaceId, businessId));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Insight generation failed" });
  }
});

router.patch("/insights/:id/dismiss", (req, res) => {
  try { res.json(dismissInsight(req.params.id)); }
  catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : "Not found" }); }
});

/* ═══════════════════════════════════════════════
   INTEGRATIONS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/integrations", (req, res) => res.json(getOrCreateIntegrations(req.params.id)));

router.post("/workspaces/:id/integrations/:platform/connect", (req, res) => {
  const platform = req.params.platform as any;
  const { accountName } = req.body;
  try {
    res.json(connectIntegration(req.params.id, platform, accountName ?? "My Ad Account"));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Connect failed" });
  }
});

router.post("/workspaces/:id/integrations/:platform/disconnect", (req, res) => {
  try { res.json(disconnectIntegration(req.params.id, req.params.platform as any)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Disconnect failed" }); }
});

router.patch("/workspaces/:id/integrations/:platform/settings", (req, res) => {
  try { res.json(updateIntegrationSettings(req.params.id, req.params.platform as any, req.body ?? {})); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Settings update failed" }); }
});

/* ═══════════════════════════════════════════════
   DRAFTS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/drafts", (req, res) => {
  seedDemoDrafts(req.params.id);
  res.json(listDrafts(req.params.id));
});

router.post("/workspaces/:id/drafts", (req, res) => {
  const parsed = z.object({
    name: z.string().min(1),
    type: z.enum(["campaign", "ad_set", "ad"]),
    data: z.record(z.unknown()),
    aiRecommendation: z.string().optional(),
    score: z.number().optional(),
    scheduledAt: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(createDraft(req.params.id, parsed.data));
});

router.patch("/drafts/:id", (req, res) => {
  try { res.json(updateDraft(req.params.id, req.body)); }
  catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : "Not found" }); }
});

router.post("/drafts/:id/publish", (req, res) => {
  try { res.json(publishDraft(req.params.id)); }
  catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : "Not found" }); }
});

router.post("/drafts/:id/schedule", (req, res) => {
  const { scheduledAt } = req.body;
  if (!scheduledAt) return res.status(400).json({ error: "scheduledAt required" });
  try { res.json(scheduleDraft(req.params.id, scheduledAt)); }
  catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : "Not found" }); }
});

router.delete("/drafts/:id", (req, res) => {
  const deleted = deleteDraft(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

/* ═══════════════════════════════════════════════
   AD SETS & ADS
   ═══════════════════════════════════════════════ */

router.get("/campaigns/:id/ad-sets", (req, res) => res.json(listAdSets(req.params.id)));

router.post("/campaigns/:id/ad-sets", (req, res) => {
  const parsed = z.object({
    name: z.string().min(1),
    status: z.enum(["active", "paused", "draft"]).default("draft"),
    dailyBudgetCents: z.number().int().positive(),
    targeting: z.record(z.unknown()).default({}),
    placements: z.array(z.string()).default([]),
    bidStrategy: z.string().default("lowest_cost"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(createAdSet(req.params.id, parsed.data));
});

router.get("/ad-sets/:id/ads", (req, res) => res.json(listAds(req.params.id)));

router.post("/ad-sets/:id/ads", (req, res) => {
  const parsed = z.object({
    name: z.string().min(1),
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
  res.status(201).json(createAd(req.params.id, parsed.data));
});

router.patch("/ads/:id", (req, res) => {
  try { res.json(updateAd(req.params.id, req.body)); }
  catch (err) { res.status(404).json({ error: err instanceof Error ? err.message : "Not found" }); }
});

/* ═══════════════════════════════════════════════
   BUSINESSES (existing)
   ═══════════════════════════════════════════════ */

const businessSchema = z.object({
  name: z.string().min(1),
  website: z.string().url().optional(),
  industry: z.string().min(1),
  monthlyBudgetCents: z.number().int().positive(),
  goals: z.array(z.string()).min(1),
  targetAudience: z.string().optional(),
});

router.post("/businesses", (req, res) => {
  const parsed = businessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(createBusiness(parsed.data));
});

router.get("/businesses", (_req, res) => res.json(listBusinesses()));

router.get("/businesses/:id", (req, res) => {
  const business = getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Not found" });
  res.json(business);
});

router.patch("/businesses/:id", (req, res) => {
  const business = getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Not found" });
  const parsed = businessSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(updateBusiness(req.params.id, parsed.data));
});

router.post("/businesses/:id/strategies", async (req, res) => {
  const business = getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Business not found" });
  try {
    const strategy = await generateStrategy(business);
    res.status(201).json(strategy);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Strategy generation failed" });
  }
});

router.get("/businesses/:id/strategies", (req, res) => res.json(listStrategiesForBusiness(req.params.id)));
router.get("/strategies/:id", (req, res) => {
  const strategy = getStrategy(req.params.id);
  if (!strategy) return res.status(404).json({ error: "Not found" });
  res.json(strategy);
});

// Analytics
router.get("/businesses/:id/analytics/summary", (req, res) => {
  const period = (req.query.period as "all" | "month" | "week") ?? "all";
  res.json(getAnalyticsSummary(req.params.id, period));
});

router.get("/businesses/:id/audience-suggestions", async (req, res) => {
  try { res.json(await getAudienceSuggestions(req.params.id)); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Audience suggestion failed" }); }
});

// Creatives
const creativeSchema = z.object({
  headline: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  callToAction: z.string().min(1).max(50),
  format: z.enum(["text", "image", "video"]).optional(),
  tags: z.array(z.string()).optional(),
});

router.get("/businesses/:id/creatives", (req, res) => res.json(listCreatives(req.params.id)));
router.post("/businesses/:id/creatives", (req, res) => {
  const parsed = creativeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(createCreative(req.params.id, parsed.data));
});
router.get("/creatives/:id", (req, res) => {
  const creative = getCreative(req.params.id);
  if (!creative) return res.status(404).json({ error: "Not found" });
  res.json(creative);
});
router.delete("/creatives/:id", (req, res) => {
  const deleted = deleteCreative(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});
router.post("/creatives/variations", async (req, res) => {
  const parsed = z.object({ headline: z.string(), body: z.string(), callToAction: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await generateCreativeVariations(parsed.data)); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Variation generation failed" }); }
});

// Campaigns
const campaignSchema = z.object({
  strategyId: z.string().min(1),
  name: z.string().min(1),
  dailyBudgetCents: z.number().int().positive(),
});

router.post("/campaigns", (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const campaign = buildCampaignFromStrategy(parsed.data.strategyId, parsed.data.name, parsed.data.dailyBudgetCents);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to build campaign" });
  }
});

router.get("/businesses/:id/campaigns", (req, res) => res.json(listCampaignsForBusiness(req.params.id)));
router.get("/campaigns/:id", (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Not found" });
  res.json(campaign);
});
router.patch("/campaigns/:id", (req, res) => {
  const parsed = z.object({ name: z.string().optional(), dailyBudgetCents: z.number().int().positive().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(updateCampaign(req.params.id, parsed.data)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" }); }
});
router.post("/campaigns/:id/launch", async (req, res) => {
  try { res.json(await launchCampaign(req.params.id)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Launch failed" }); }
});
router.post("/campaigns/:id/variants/:variantId/pause", async (req, res) => {
  try { res.json(await pauseVariant(req.params.id, req.params.variantId)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Pause failed" }); }
});
router.post("/campaigns/:id/ingest", async (req, res) => {
  try { res.json(await ingestCampaignMetrics(req.params.id)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Ingest failed" }); }
});
router.get("/campaigns/:id/performance", (req, res) => res.json(normalizePerformance(req.params.id)));
router.get("/campaigns/:id/trend", (req, res) => res.json(getCampaignTrend(req.params.id)));
router.post("/campaigns/:id/optimize", async (req, res) => {
  try { res.json(await runOptimizationPass(req.params.id)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Optimization failed" }); }
});

// Billing
const invoiceSchema = z.object({ periodStart: z.string(), periodEnd: z.string() });
router.post("/businesses/:id/invoices", (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(generateInvoice(req.params.id, parsed.data.periodStart, parsed.data.periodEnd));
});
router.get("/businesses/:id/invoices", (req, res) => res.json(listInvoices(req.params.id)));

// Onboarding
const scrapeSchema = z.object({ url: z.string().min(1) });
router.post("/onboarding/scrape", async (req, res) => {
  const parsed = scrapeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await scrapeUrl(parsed.data.url)); }
  catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : "Failed to scrape URL" }); }
});

const productAnalysisSchema = z.object({ url: z.string(), title: z.string(), description: z.string(), excerpt: z.string() });
router.post("/onboarding/analyze-product", async (req, res) => {
  const parsed = productAnalysisSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await analyzeProduct(parsed.data)); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Product analysis failed" }); }
});

const audienceAnalysisSchema = z.object({
  site: productAnalysisSchema,
  product: z.object({ productName: z.string(), category: z.string(), summary: z.string(), valueProposition: z.string(), keyFeatures: z.array(z.string()) }),
});
router.post("/onboarding/analyze-audience", async (req, res) => {
  const parsed = audienceAnalysisSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await analyzeAudience(parsed.data.site, parsed.data.product)); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Audience analysis failed" }); }
});
