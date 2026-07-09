import "./loadEnv.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { asyncHandler } from "./asyncHandler.js";
import { internalServiceAuth } from "./internalAuth.js";
import { sendError, isNotFoundError } from "./errorResponse.js";
import {
  buildCampaignFromStrategy,
  buildCampaignFromSuggestions,
  launchCampaign,
  listCampaignsForBusiness,
  getCampaign,
  pauseVariant,
  activateVariant,
  applyCreativeMedia,
  updateCampaign,
} from "../../api/src/modules/orchestrator/campaignOrchestrator.js";
import { ingestCampaignMetrics, normalizePerformance, getLiveInsights } from "../../api/src/modules/pipeline/performancePipeline.js";
import { runOptimizationPass } from "../../api/src/modules/optimization/optimizationEngine.js";
import { recordOptimizationInsights } from "../../api/src/modules/insights/insightService.js";
import { generateInvoice, listInvoices } from "../../api/src/modules/billing/billingEngine.js";
import { generateCampaignSuggestions, createStrategyFromSuggestions } from "../../api/src/modules/strategy/strategyEngine.js";
import { getResearchSession, setResearchSessionCampaignSuggestions } from "../../api/src/modules/onboarding/researchSessionService.js";

const app = express();
const PORT = Number(process.env.CAMPAIGN_SERVICE_PORT ?? 4002);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "campaign-service" }));

app.use(internalServiceAuth);

/* ═══════════════════════════════════════════════
   CAMPAIGNS — extracted from the gateway per roadmap Phase 2.
   Reads/writes the same Postgres database as the gateway (shared-database
   pattern, appropriate at this stage) — the gateway's own analytics/insights/
   strategist modules keep calling campaignOrchestrator/performancePipeline
   in-process for cross-cutting reads, since a full HTTP round-trip for every
   internal read is exactly the premature complexity this phase avoids until
   there's a real reason (e.g. those modules become services too).
   ═══════════════════════════════════════════════ */

// Generic ceiling for ad-spend fields — prevents an obviously-wrong value (e.g. a
// misplaced decimal) from being accepted with no upper bound. Adjust per business need.
const MAX_BUDGET_CENTS = 100_000_000; // $1,000,000

const campaignSchema = z.object({
  strategyId: z.string().min(1),
  name: z.string().trim().min(1),
  dailyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS),
});

app.post("/campaigns", asyncHandler(async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const campaign = await buildCampaignFromStrategy(parsed.data.strategyId, parsed.data.name, parsed.data.dailyBudgetCents);
    res.status(201).json(campaign);
  } catch (err) {
    sendError(res, err, 400, "Failed to build campaign");
  }
}));

const campaignFromSuggestionsSchema = z.object({
  researchSessionId: z.string().min(1),
  businessId: z.string().min(1),
  name: z.string().trim().min(1),
  dailyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS),
});

// Builds one campaign whose ads are the 6+ AI-generated suggestions directly — the user lands
// straight in the builder with ready-to-edit ads instead of a single generic one. Generates
// suggestions on first call and caches them on the session (idempotent), same as any other
// research-session field, so re-clicking "Generate Campaign" after a failed attempt doesn't
// spend a second OpenAI call or produce a different set of ads.
app.post("/campaigns/from-suggestions", asyncHandler(async (req, res) => {
  const parsed = campaignFromSuggestionsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { researchSessionId, businessId, name, dailyBudgetCents } = parsed.data;

  const session = await getResearchSession(researchSessionId);
  if (!session) return res.status(404).json({ error: "Research session not found" });
  if (session.status !== "done" || !session.result) {
    return res.status(409).json({ error: "Research session is not complete" });
  }

  try {
    let suggestions = session.campaignSuggestions;
    if (!suggestions || suggestions.length === 0) {
      suggestions = await generateCampaignSuggestions(session.result as any);
      const updated = await setResearchSessionCampaignSuggestions(session.id, suggestions);
      suggestions = updated.campaignSuggestions;
    }
    const strategy = await createStrategyFromSuggestions(businessId, session.result as any, suggestions!);
    const campaign = await buildCampaignFromSuggestions(strategy.id, suggestions!, name, dailyBudgetCents);
    res.status(201).json(campaign);
  } catch (err) {
    sendError(res, err, 502, "Failed to build campaign from suggestions");
  }
}));

app.get("/businesses/:id/campaigns", asyncHandler(async (req, res) => res.json(await listCampaignsForBusiness(req.params.id))));

app.get("/campaigns/:id", asyncHandler(async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Not found" });
  res.json(campaign);
}));

const campaignVariantSchema = z.object({
  id: z.string().min(1),
  creative: z.object({
    headline: z.string(),
    body: z.string(),
    callToAction: z.string(),
    imageUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    headlines: z.array(z.string()).max(5).optional(),
    primaryTexts: z.array(z.string()).max(5).optional(),
  }),
  network: z.enum(["meta", "google", "tiktok"]),
  externalId: z.string().optional(),
  status: z.enum(["draft", "launching", "active", "paused", "completed", "failed"]),
  audienceName: z.string().optional(),
  landingPageUrl: z.string().optional(),
  adSetExternalId: z.string().optional(),
});

const creativeAssetSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  type: z.enum(["image", "video"]),
  source: z.enum(["ai", "upload"]),
});

// Broadened for the manual campaign builder (CampaignBuilder.tsx) — every field beyond
// name/dailyBudgetCents is optional so the /wizard instant-generate flow's simpler
// updateCampaign calls keep working unchanged.
const campaignPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  dailyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS).optional(),
  conversionEvent: z.string().optional(),
  finalUrl: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  locations: z.array(z.string()).optional(),
  advantagePlus: z.boolean().optional(),
  metaAdAccountId: z.string().optional(),
  pageId: z.string().optional(),
  instagramAccountId: z.string().optional(),
  pixelId: z.string().optional(),
  googleCustomerId: z.string().optional(),
  googleConversionActionId: z.string().optional(),
  variants: z.array(campaignVariantSchema).optional(),
  creativeAssets: z.array(creativeAssetSchema).max(10).optional(),
});

app.patch("/campaigns/:id", asyncHandler(async (req, res) => {
  const parsed = campaignPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateCampaign(req.params.id, parsed.data)); }
  catch (err) { sendError(res, err, isNotFoundError(err) ? 404 : 400, "Update failed"); }
}));

app.post("/campaigns/:id/launch", asyncHandler(async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "demo";
  try { res.json(await launchCampaign(req.params.id, workspaceId)); }
  catch (err) { sendError(res, err, isNotFoundError(err) ? 404 : 400, "Launch failed"); }
}));

app.post("/campaigns/:id/variants/:variantId/pause", asyncHandler(async (req, res) => {
  try { res.json(await pauseVariant(req.params.id, req.params.variantId)); }
  catch (err) { sendError(res, err, isNotFoundError(err) ? 404 : 400, "Pause failed"); }
}));

app.post("/campaigns/:id/variants/:variantId/activate", asyncHandler(async (req, res) => {
  try { res.json(await activateVariant(req.params.id, req.params.variantId)); }
  catch (err) { sendError(res, err, isNotFoundError(err) ? 404 : 400, "Activate failed"); }
}));

app.post("/campaigns/:id/apply-creative-media", asyncHandler(async (req, res) => {
  // Not z.string().url() — objectStorage.put() returns relative paths ("/objects/...") in
  // local dev (LocalFileObjectStorage doesn't know its own public origin).
  const parsed = z.object({ imageUrl: z.string().min(1).optional(), videoUrl: z.string().min(1).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await applyCreativeMedia(req.params.id, parsed.data)); }
  catch (err) { sendError(res, err, 400, "Failed to apply creative media"); }
}));

app.post("/campaigns/:id/ingest", asyncHandler(async (req, res) => {
  try { res.json(await ingestCampaignMetrics(req.params.id)); }
  catch (err) { sendError(res, err, 400, "Ingest failed"); }
}));

app.get("/campaigns/:id/performance", asyncHandler(async (req, res) => res.json(await normalizePerformance(req.params.id))));

app.get("/campaigns/:id/live-insights", asyncHandler(async (req, res) => {
  try { res.json(await getLiveInsights(req.params.id)); }
  catch (err) { sendError(res, err, 404, "Not found"); }
}));

app.post("/campaigns/:id/optimize", asyncHandler(async (req, res) => {
  try {
    const decisions = await runOptimizationPass(req.params.id);
    const campaign = await getCampaign(req.params.id);
    await recordOptimizationInsights(campaign?.workspaceId ?? "demo", decisions);
    res.json(decisions);
  } catch (err) {
    sendError(res, err, 400, "Optimization failed");
  }
}));

/* ═══════════════════════════════════════════════
   BILLING
   ═══════════════════════════════════════════════ */

const invoiceSchema = z.object({ periodStart: z.string(), periodEnd: z.string() });

app.post("/businesses/:id/invoices", asyncHandler(async (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await generateInvoice(req.params.id, parsed.data.periodStart, parsed.data.periodEnd));
}));

app.get("/businesses/:id/invoices", asyncHandler(async (req, res) => res.json(await listInvoices(req.params.id))));

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`AdGo Campaign Service listening on http://localhost:${PORT}`);
});
