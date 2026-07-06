import { Router } from "express";
import { asyncHandler } from "./asyncHandler.js";
import { sendError } from "./errorResponse.js";
import { prisma } from "../db/prisma.js";
import {
  listLeadForms,
  listLeads,
  seedMockLeadData,
  type LeadPlatform,
} from "../modules/leadgen/leadIngestionService.js";
import { backfillMetaLeads } from "../modules/leadgen/metaLeadSync.js";
import { syncGoogleLeadForms, syncGoogleLeadSubmissions } from "../modules/leadgen/googleLeadSyncService.js";
import { getMetaCredentials, getOrCreateIntegrations } from "../modules/integrations/integrationService.js";
import { getGoogleAdsCredentials } from "../modules/integrations/googleOAuth.js";
import { getRawMetrics } from "../modules/pipeline/performancePipeline.js";
import { listSavedAudiences } from "../modules/audience/savedAudienceService.js";
import { estimateReachHeuristic } from "../modules/adapters/metaTargetingMapper.js";
import { leadIngestionQueue } from "../infra/queue.js";
import type { AdNetwork } from "../types/index.js";

/**
 * Surfaces AdGo's ad automation data (insights/leads/lead forms/audiences) for
 * sales_tech_frontend (the CRM). Response shapes deliberately mirror the CRM's
 * existing Google-Ads tab contracts (field_data, form_id, cost_micros, date_preset)
 * even for Meta-sourced rows, so the CRM's existing hooks/columns need minimal changes.
 * Mounted at /api/crm behind crmInternalAuth — never called directly from a browser.
 */
export const adsDataRoutes = Router();

function isLeadPlatform(value: unknown): value is LeadPlatform {
  return value === "meta" || value === "google";
}

async function hasRealCredentials(workspaceId: string, platform: LeadPlatform): Promise<boolean> {
  if (platform === "meta") return Boolean(await getMetaCredentials(workspaceId));
  return Boolean(await getGoogleAdsCredentials(workspaceId));
}

/** Seeds mock leads/forms for a platform only if it has no real integration credentials yet — real, connected platforms wait for an actual sync instead of being papered over with fake data. */
async function ensureMockDataIfDisconnected(workspaceId: string, platform: LeadPlatform): Promise<void> {
  if (await hasRealCredentials(workspaceId, platform)) return;
  await seedMockLeadData(workspaceId, platform);
}

/* ── Lead Forms ─────────────────────────────────────────────────────────── */

adsDataRoutes.get(
  "/workspaces/:id/ads-data/lead-forms",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const platform = isLeadPlatform(req.query.platform) ? req.query.platform : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.page_size ? Number(req.query.page_size) : undefined;

    for (const p of platform ? [platform] : (["meta", "google"] as LeadPlatform[])) {
      await ensureMockDataIfDisconnected(workspaceId, p);
    }

    const { data, total } = await listLeadForms(workspaceId, { platform, page, pageSize });
    res.json({
      data: data.map((f) => ({
        id: f.id,
        name: f.name,
        headline: (f.data as any).headline ?? null,
        business_name: (f.data as any).business_name ?? null,
        call_to_action_type: (f.data as any).call_to_action_type ?? null,
        fields: (f.data as any).fields ?? [],
        platform: f.platform,
        status: f.status,
      })),
      total,
    });
  })
);

/* ── Leads ──────────────────────────────────────────────────────────────── */

adsDataRoutes.get(
  "/workspaces/:id/ads-data/leads",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const platform = isLeadPlatform(req.query.platform) ? req.query.platform : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.page_size ? Number(req.query.page_size) : undefined;
    const formId = typeof req.query.formId === "string" ? req.query.formId : undefined;
    const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : undefined;

    for (const p of platform ? [platform] : (["meta", "google"] as LeadPlatform[])) {
      await ensureMockDataIfDisconnected(workspaceId, p);
    }

    const { data, total } = await listLeads(workspaceId, { platform, formId, campaignId, page, pageSize });
    res.json({
      data: data.map((l) => ({
        id: l.id,
        form_id: l.formExternalId,
        field_data: l.data,
        created_at: l.submittedAt.toISOString(),
        platform: l.platform,
      })),
      total,
    });
  })
);

adsDataRoutes.post(
  "/workspaces/:id/ads-data/leads/sync",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const platform = req.query.platform;
    if (!isLeadPlatform(platform)) {
      return sendError(res, new Error("platform must be 'meta' or 'google'"), 400, "Invalid platform");
    }

    const connected = await hasRealCredentials(workspaceId, platform);
    if (!connected) {
      return sendError(res, new Error(`${platform} is not connected for this workspace`), 409, "Platform not connected");
    }

    await leadIngestionQueue.add("backfill", { workspaceId, platform });
    res.status(202).json({ status: "started" });
  })
);

adsDataRoutes.get(
  "/workspaces/:id/ads-data/leads/sync/status",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const platform = req.query.platform;
    if (!isLeadPlatform(platform)) {
      return sendError(res, new Error("platform must be 'meta' or 'google'"), 400, "Invalid platform");
    }
    const integrations = await getOrCreateIntegrations(workspaceId);
    const integration = integrations.find((i) => i.platform === platform);
    res.json({ lastLeadSyncAt: (integration?.settings?.lastLeadSyncAt as string | undefined) ?? null });
  })
);

/* ── Insights (performance metrics) ────────────────────────────────────── */

const NETWORK_BY_PLATFORM: Record<LeadPlatform, AdNetwork> = { meta: "meta", google: "google" };

adsDataRoutes.get(
  "/workspaces/:id/ads-data/insights",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const platform = isLeadPlatform(req.query.platform) ? req.query.platform : undefined;
    const network = platform ? NETWORK_BY_PLATFORM[platform] : undefined;

    const campaigns = await prisma.campaign.findMany({ where: { workspaceId } });

    type Row = { date: string; id: string; name: string; metrics: { impressions: number; clicks: number; cost_micros: number; conversions: number } };
    const rows: Row[] = [];

    for (const c of campaigns) {
      const campaignData = c.data as any;
      const name: string = campaignData?.name ?? c.id;
      const metrics = await getRawMetrics(c.id);
      const byDate = new Map<string, { impressions: number; clicks: number; conversions: number; spendCents: number }>();
      for (const m of metrics) {
        if (network && m.network !== network) continue;
        const acc = byDate.get(m.date) ?? { impressions: 0, clicks: 0, conversions: 0, spendCents: 0 };
        acc.impressions += m.impressions;
        acc.clicks += m.clicks;
        acc.conversions += m.conversions;
        acc.spendCents += m.spendCents;
        byDate.set(m.date, acc);
      }
      for (const [date, acc] of byDate) {
        rows.push({
          date,
          id: c.id,
          name,
          metrics: {
            impressions: acc.impressions,
            clicks: acc.clicks,
            conversions: acc.conversions,
            // CRM/Google convention: cost in micros of the currency unit. AdGo stores spend in cents;
            // 1 cent = 10,000 micros (1 currency unit = 100 cents = 1,000,000 micros).
            cost_micros: acc.spendCents * 10_000,
          },
        });
      }
    }

    res.json({ data: rows });
  })
);

/* ── Audiences ──────────────────────────────────────────────────────────── */

adsDataRoutes.get(
  "/workspaces/:id/ads-data/audiences",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const audiences = await listSavedAudiences(workspaceId);

    const data = audiences.map((a) => {
      const reach = estimateReachHeuristic(a);
      const size = Math.round((reach.usersLowerBound + reach.usersUpperBound) / 2);
      return {
        name: a.name,
        type: "Custom Audience",
        status: "OPEN",
        size_search: size,
        size_display: size,
      };
    });

    res.json({ data });
  })
);

/* ── Campaigns (for lead-form-to-campaign linkage in the CRM UI) ─────────── */

adsDataRoutes.get(
  "/workspaces/:id/ads-data/campaigns",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const campaigns = await prisma.campaign.findMany({ where: { workspaceId } });
    res.json({
      data: campaigns.map((c) => {
        const d = c.data as any;
        return { id: c.id, name: d?.name ?? c.id, networks: d?.networks ?? [], status: d?.status ?? "unknown" };
      }),
    });
  })
);
