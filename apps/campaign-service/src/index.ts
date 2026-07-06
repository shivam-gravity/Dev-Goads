import "./loadEnv.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { asyncHandler } from "./asyncHandler.js";
import { internalServiceAuth } from "./internalAuth.js";
import { sendError } from "./errorResponse.js";
import {
  buildCampaignFromStrategy,
  launchCampaign,
  listCampaignsForBusiness,
  getCampaign,
  pauseVariant,
  updateCampaign,
} from "../../api/src/modules/orchestrator/campaignOrchestrator.js";
import { ingestCampaignMetrics, normalizePerformance } from "../../api/src/modules/pipeline/performancePipeline.js";
import { runOptimizationPass } from "../../api/src/modules/optimization/optimizationEngine.js";
import { generateInvoice, listInvoices } from "../../api/src/modules/billing/billingEngine.js";

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

app.get("/businesses/:id/campaigns", asyncHandler(async (req, res) => res.json(await listCampaignsForBusiness(req.params.id))));

app.get("/campaigns/:id", asyncHandler(async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "Not found" });
  res.json(campaign);
}));

app.patch("/campaigns/:id", asyncHandler(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).optional(), dailyBudgetCents: z.number().int().positive().max(MAX_BUDGET_CENTS).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateCampaign(req.params.id, parsed.data)); }
  catch (err) { sendError(res, err, 400, "Update failed"); }
}));

app.post("/campaigns/:id/launch", asyncHandler(async (req, res) => {
  try { res.json(await launchCampaign(req.params.id)); }
  catch (err) { sendError(res, err, 400, "Launch failed"); }
}));

app.post("/campaigns/:id/variants/:variantId/pause", asyncHandler(async (req, res) => {
  try { res.json(await pauseVariant(req.params.id, req.params.variantId)); }
  catch (err) { sendError(res, err, 400, "Pause failed"); }
}));

app.post("/campaigns/:id/ingest", asyncHandler(async (req, res) => {
  try { res.json(await ingestCampaignMetrics(req.params.id)); }
  catch (err) { sendError(res, err, 400, "Ingest failed"); }
}));

app.get("/campaigns/:id/performance", asyncHandler(async (req, res) => res.json(await normalizePerformance(req.params.id))));

app.post("/campaigns/:id/optimize", asyncHandler(async (req, res) => {
  try { res.json(await runOptimizationPass(req.params.id)); }
  catch (err) { sendError(res, err, 400, "Optimization failed"); }
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
