import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "./asyncHandler.js";
import { sendError } from "./errorResponse.js";
import { prisma } from "../db/prisma.js";
import { logger } from "../modules/logger/logger.js";
import { requireWorkspaceMember, requireBusinessAccess } from "./middleware/workspaceAccess.js";
import { getMembership } from "../modules/workspace/workspaceService.js";
import type { AuthedRequest } from "./middleware/auth.js";

import { createBusiness, getBusiness, listBusinesses, updateBusiness } from "../modules/business/businessService.js";
import { scrapeUrl } from "../modules/onboarding/scraper.js";
import { analyzeAudience, analyzeProduct, runDeepResearch } from "../modules/onboarding/analysis.js";
import { findCachedSession, cloneSessionFromCache, createResearchSession, getResearchSession } from "../modules/onboarding/researchSessionService.js";
import { getOrCreateIntegrations, connectIntegration, disconnectIntegration, updateIntegrationSettings, getMetaCredentials, sanitizeIntegration, setMetaManualConnection, setGoogleManualConnection } from "../modules/integrations/integrationService.js";
import { listAdAccounts as listMetaAdAccountsGraph, listPages as listMetaPagesGraph, listInstagramAccounts as listMetaInstagramAccountsGraph, listPixels as listMetaPixelsGraph } from "../modules/integrations/metaOAuth.js";
import { listAccessibleCustomers as listGoogleCustomersApi, listConversionActions as listGoogleConversionActionsApi } from "../modules/integrations/googleOAuth.js";
import { getCrmWebhookConfig, setCrmWebhookConfig, clearCrmWebhookConfig } from "../modules/crm/crmWebhookService.js";
import { researchSessionQueue } from "../infra/queue.js";
import { buildMetaTargetingSpec, fetchMetaReachEstimate, estimateReachHeuristic, resolveInterests } from "../modules/adapters/metaTargetingMapper.js";

export const router = Router();

export const authEntryRouter = Router();
// Auth routes would be proxied to auth-service if running; for now just placeholder
authEntryRouter.post("/auth/register", (_req, res) => res.status(501).json({ error: "Auth service not running" }));
authEntryRouter.post("/auth/login", (_req, res) => res.status(501).json({ error: "Auth service not running" }));

/* ═══════════════════════════════════════════════
   BUSINESSES
   ═══════════════════════════════════════════════ */

const MAX_BUDGET_CENTS = 100_000_000;

const businessProfileFields = {
  name: z.string().trim().min(1),
  website: z.string().url().optional(),
  industry: z.string().trim().min(1),
  monthlyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS),
  goals: z.array(z.string()).min(1),
  targetAudience: z.string().optional(),
  brandName: z.string().trim().min(1).optional(),
  logoUrls: z.array(z.string()).max(5).optional(),
};
const businessCreateSchema = z.object({ workspaceId: z.string().min(1), ...businessProfileFields });
const businessUpdateSchema = z.object(businessProfileFields).partial();

router.post("/businesses", requireWorkspaceMember("body", "workspaceId"), asyncHandler(async (req, res) => {
  const parsed = businessCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await createBusiness(parsed.data));
  } catch (err) {
    sendError(res, err, 409, "Failed to create business");
  }
}));

router.get("/businesses", asyncHandler(async (req: AuthedRequest, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId query param required" });
  if (!(await getMembership(workspaceId, req.userId!))) {
    return res.status(403).json({ error: "You do not have access to this workspace" });
  }
  res.json(await listBusinesses(workspaceId));
}));

router.get("/businesses/:id", requireBusinessAccess("params", "id"), asyncHandler(async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Not found" });
  res.json(business);
}));

router.patch("/businesses/:id", requireBusinessAccess("params", "id"), asyncHandler(async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Not found" });
  const parsed = businessUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await updateBusiness(req.params.id, parsed.data));
}));

/* ═══════════════════════════════════════════════
   INTEGRATIONS
   ═══════════════════════════════════════════════ */

router.get("/workspaces/:id/integrations", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => res.json((await getOrCreateIntegrations(req.params.id)).map(sanitizeIntegration))));

const INTEGRATION_PLATFORMS = ["meta", "google", "tiktok", "shopify", "woocommerce", "pixel"] as const;

router.post("/workspaces/:id/integrations/:platform/connect", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  const platform = req.params.platform as any;
  if (!INTEGRATION_PLATFORMS.includes(platform)) return res.status(400).json({ error: `Unknown platform "${platform}"` });
  const { accountName } = req.body;
  try {
    res.json(sanitizeIntegration(await connectIntegration(req.params.id, platform, accountName ?? "My Ad Account")));
  } catch (err) {
    sendError(res, err, 400, "Connect failed");
  }
}));

router.post("/workspaces/:id/integrations/:platform/disconnect", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(sanitizeIntegration(await disconnectIntegration(req.params.id, req.params.platform as any))); }
  catch (err) { sendError(res, err, 400, "Disconnect failed"); }
}));

router.patch("/workspaces/:id/integrations/:platform/settings", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(sanitizeIntegration(await updateIntegrationSettings(req.params.id, req.params.platform as any, req.body ?? {}))); }
  catch (err) { sendError(res, err, 400, "Settings update failed"); }
}));

const metaManualConnectSchema = z.object({
  accessToken: z.string().trim().min(1),
  adAccountId: z.string().trim().min(1),
  pageId: z.string().trim().min(1).optional(),
  pageAccessToken: z.string().trim().min(1).optional(),
});

router.post("/workspaces/:id/integrations/meta/connect-manual", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
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

router.post("/workspaces/:id/integrations/google/connect-manual", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  const parsed = googleManualConnectSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, parsed.error, 400, "Invalid manual connect payload");
  try {
    res.json(sanitizeIntegration(await setGoogleManualConnection(req.params.id, parsed.data)));
  } catch (err) {
    sendError(res, err, 400, "Manual connect failed");
  }
}));

router.get("/workspaces/:id/integrations/meta/ad-accounts", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(await listMetaAdAccountsGraph(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Meta ad accounts"); }
}));

router.get("/workspaces/:id/integrations/meta/pages", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(await listMetaPagesGraph(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Meta pages"); }
}));

router.get("/workspaces/:id/integrations/meta/pages/:pageId/instagram-accounts", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(await listMetaInstagramAccountsGraph(req.params.id, req.params.pageId)); }
  catch (err) { sendError(res, err, 502, "Failed to list Instagram accounts"); }
}));

router.get("/workspaces/:id/integrations/meta/pixels", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(await listMetaPixelsGraph(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Meta pixels"); }
}));

router.get("/workspaces/:id/integrations/google/customers", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(await listGoogleCustomersApi(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Google Ads customers"); }
}));

router.get("/workspaces/:id/integrations/google/conversion-actions", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  try { res.json(await listGoogleConversionActionsApi(req.params.id)); }
  catch (err) { sendError(res, err, 502, "Failed to list Google conversion actions"); }
}));

/* ═══════════════════════════════════════════════
   META INTEREST VALIDATION (for research pipeline)
   ═══════════════════════════════════════════════ */

router.post("/workspaces/:id/meta/validate-interests", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  const parsed = z.object({ interests: z.array(z.string()).min(1).max(50) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const credentials = await getMetaCredentials(req.params.id);
  if (!credentials) return res.status(409).json({ error: "No Meta ad account connected — interest validation requires a live Meta connection" });

  try {
    const validated = await resolveInterests(credentials.accessToken, parsed.data.interests);
    res.json({ validated, total: parsed.data.interests.length, matched: validated.length });
  } catch (err) {
    sendError(res, err, 502, "Meta interest validation failed");
  }
}));

/* ═══════════════════════════════════════════════
   CRM OUTBOUND WEBHOOK CONFIG
   ═══════════════════════════════════════════════ */

const crmWebhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(1).nullable().optional(),
});

router.get("/workspaces/:id/crm-webhook", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  const config = await getCrmWebhookConfig(req.params.id);
  res.json({ url: config?.url ?? null, configured: Boolean(config) });
}));

router.put("/workspaces/:id/crm-webhook", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  const parsed = crmWebhookConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await setCrmWebhookConfig(req.params.id, parsed.data);
  res.status(204).send();
}));

router.delete("/workspaces/:id/crm-webhook", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
  await clearCrmWebhookConfig(req.params.id);
  res.status(204).send();
}));

/* ═══════════════════════════════════════════════
   ONBOARDING / RESEARCH
   ═══════════════════════════════════════════════ */

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

const deepResearchSchema = z.object({
  url: z.string().min(1),
  businessId: z.string().optional(),
  workspaceId: z.string().optional(),
});
router.post("/onboarding/deep-research", asyncHandler(async (req, res) => {
  const parsed = deepResearchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await runDeepResearch(parsed.data.url, { businessId: parsed.data.businessId, workspaceId: parsed.data.workspaceId })); }
  catch (err) { sendError(res, err, 422, "Deep research failed"); }
}));

// Research sessions (async job-based pipeline)
const researchSessionSchema = z.object({ url: z.string().min(1), businessId: z.string().optional() });
router.post("/workspaces/:id/research-sessions", requireWorkspaceMember("params", "id"), asyncHandler(async (req, res) => {
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

router.get("/research-sessions/:id", asyncHandler(async (req: AuthedRequest, res) => {
  const session = await getResearchSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Research session not found" });
  if (!(await getMembership(session.workspaceId, req.userId!))) {
    return res.status(403).json({ error: "You do not have access to this research session" });
  }
  res.json(session);
}));

// Catch-all 404
router.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
