import { Router } from "express";
import { z } from "zod";
import { createBusiness, getBusiness, listBusinesses } from "../modules/business/businessService.js";
import { generateStrategy, getStrategy, listStrategiesForBusiness } from "../modules/strategy/strategyEngine.js";
import {
  buildCampaignFromStrategy,
  launchCampaign,
  listCampaignsForBusiness,
  getCampaign,
  pauseVariant,
} from "../modules/orchestrator/campaignOrchestrator.js";
import { ingestCampaignMetrics, normalizePerformance } from "../modules/pipeline/performancePipeline.js";
import { runOptimizationPass } from "../modules/optimization/optimizationEngine.js";
import { generateInvoice, listInvoices } from "../modules/billing/billingEngine.js";
import { issueDemoToken } from "./middleware/auth.js";

export const router = Router();

router.post("/auth/demo-token", (req, res) => {
  const subject = typeof req.body?.subject === "string" ? req.body.subject : "demo-user";
  res.json({ token: issueDemoToken(subject) });
});

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

router.post("/campaigns/:id/launch", async (req, res) => {
  try {
    res.json(await launchCampaign(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Launch failed" });
  }
});

router.post("/campaigns/:id/variants/:variantId/pause", async (req, res) => {
  try {
    res.json(await pauseVariant(req.params.id, req.params.variantId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Pause failed" });
  }
});

router.post("/campaigns/:id/ingest", async (req, res) => {
  try {
    res.json(await ingestCampaignMetrics(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Ingest failed" });
  }
});

router.get("/campaigns/:id/performance", (req, res) => res.json(normalizePerformance(req.params.id)));

router.post("/campaigns/:id/optimize", async (req, res) => {
  try {
    res.json(await runOptimizationPass(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Optimization failed" });
  }
});

const invoiceSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
});

router.post("/businesses/:id/invoices", (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(generateInvoice(req.params.id, parsed.data.periodStart, parsed.data.periodEnd));
});

router.get("/businesses/:id/invoices", (req, res) => res.json(listInvoices(req.params.id)));
