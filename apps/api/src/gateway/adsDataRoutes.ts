import { Router } from "express";
import { asyncHandler } from "./asyncHandler.js";
import { sendError } from "./errorResponse.js";
import { prisma } from "../db/prisma.js";
import { externalLogin } from "../modules/auth/crmAuthService.js";
import {
  listLeadForms,
  listLeads,
  toCrmLeadPayload,
  type LeadPlatform,
} from "../modules/leadgen/leadIngestionService.js";
import { listContacts } from "../modules/leadgen/contactService.js";
import { backfillMetaLeads } from "../modules/leadgen/metaLeadSync.js";
import { syncGoogleLeadForms, syncGoogleLeadSubmissions } from "../modules/leadgen/googleLeadSyncService.js";
import { getMetaCredentials, getOrCreateIntegrations } from "../modules/integrations/integrationService.js";
import { getGoogleAdsCredentials } from "../modules/integrations/googleOAuth.js";
import { getRawMetrics, ingestCampaignMetrics } from "../modules/pipeline/performancePipeline.js";
import { logger } from "../modules/logger/logger.js";
import { listSavedAudiences, type AudienceType } from "../modules/audience/savedAudienceService.js";
import { estimateReachHeuristic } from "../modules/adapters/metaTargetingMapper.js";
import { leadIngestionQueue } from "../infra/queue.js";
import type { AdNetwork } from "../types/index.js";

/**
 * Surfaces Polluxa's ad automation data (insights/leads/lead forms/audiences) for
 * sales_tech_frontend (the CRM). Response shapes deliberately mirror the CRM's
 * existing Google-Ads tab contracts (field_data, form_id, cost_micros, date_preset)
 * even for Meta-sourced rows, so the CRM's existing hooks/columns need minimal changes.
 * Mounted at /api/crm behind crmInternalAuth — never called directly from a browser.
 */
export const adsDataRoutes = Router();

/* ── External login (shared-secret) ─────────────────────────────────────────
 * The CRM data-plane proxy (sales_tech_backend/integration/devgoads_proxy.py) calls this
 * FIRST to resolve a CRM identity → this workspace's id + a Dev-Goads user JWT, which it then
 * uses for all the ads-data reads below. Without this route the proxy's external-login 404'd,
 * so every "Automated Ads Insights" tab load failed with "insights are unavailable". Returns
 * exactly the { workspaceId, accessToken } the proxy reads (businessId is extra, harmless). */
adsDataRoutes.post(
  "/auth/external-login",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const externalUserId = body.externalUserId != null ? String(body.externalUserId) : "";
    if (!email && !externalUserId) {
      return sendError(res, new Error("email or externalUserId is required"), 400, "Missing CRM identity");
    }
    const result = await externalLogin({
      email: email || `${externalUserId}@crm.local`,
      name: typeof body.name === "string" ? body.name : undefined,
      source: typeof body.source === "string" ? body.source : "crm",
      externalUserId: externalUserId || undefined,
      businessId: body.businessId != null ? String(body.businessId) : undefined,
      businessName: typeof body.businessName === "string" ? body.businessName : undefined,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : undefined,
      partnerId: body.partnerId != null ? String(body.partnerId) : undefined,
    });
    res.json(result);
  })
);

function isLeadPlatform(value: unknown): value is LeadPlatform {
  return value === "meta" || value === "google";
}

async function hasRealCredentials(workspaceId: string, platform: LeadPlatform): Promise<boolean> {
  if (platform === "meta") return Boolean(await getMetaCredentials(workspaceId));
  return Boolean(await getGoogleAdsCredentials(workspaceId));
}

/** No-op: mock lead/form seeding has been removed. A disconnected platform now shows an honest
 * empty CRM (no leads/forms) until a real integration is connected and syncs actual data, rather
 * than being papered over with fabricated leads ("Priya Sharma", @example.com). Kept as a no-op so
 * the GET routes' call sites stay unchanged. */
async function ensureMockDataIfDisconnected(_workspaceId: string, _platform: LeadPlatform): Promise<void> {
  return;
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
      data: data.map(toCrmLeadPayload),
      total,
    });
  })
);

/* ── Contacts (Stage C: Lead → Normalizer → CRM Contact) ───────────────── */

adsDataRoutes.get(
  "/workspaces/:id/ads-data/contacts",
  asyncHandler(async (req, res) => {
    const workspaceId = req.params.id;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.page_size ? Number(req.query.page_size) : undefined;

    for (const p of ["meta", "google"] as LeadPlatform[]) {
      await ensureMockDataIfDisconnected(workspaceId, p);
    }

    const { data, total } = await listContacts(workspaceId, { page, pageSize });
    res.json({
      data: data.map((c) => ({
        id: c.id,
        full_name: c.fullName,
        email: c.email,
        phone: c.phone,
        company_name: c.companyName,
        lead_count: c.leadCount,
        first_seen_at: c.firstSeenAt.toISOString(),
        last_seen_at: c.lastSeenAt.toISOString(),
        platforms: c.platforms,
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

    // Real-time refresh: pull fresh insights on-demand for every LAUNCHED campaign before reading,
    // rather than serving only whatever the 15-min metricsIngestionWorker last wrote. This is what
    // makes the CRM's Automated Insights tab reflect live delivery instead of a stale/empty tick.
    // A campaign is "launched" once any variant carries a per-platform externalId (set by
    // launchMetaHierarchy/launchGoogleHierarchy); unlaunched drafts have nothing to fetch and are
    // skipped. Best-effort per campaign: one platform/credential hiccup logs and is skipped, never
    // failing the whole tab (the stored rows for the others still render). Ingests run in parallel.
    await Promise.all(
      campaigns.map(async (c) => {
        const d = c.data as any;
        const status = d?.status;
        const launched = Array.isArray(d?.variants) && d.variants.some((v: any) => v?.externalId);
        if (!launched || (status !== "active" && status !== "paused")) return;
        try {
          await ingestCampaignMetrics(c.id);
        } catch (err) {
          logger.warn(`ads-data/insights: live metrics ingest failed for campaign ${c.id} — serving last stored metrics`, err);
        }
      })
    );

    type Row = {
      date: string; id: string; name: string;
      metrics: { impressions: number; reach: number; clicks: number; conversions: number; cost_micros: number; cpm_micros: number; cpc_micros: number; roas: number };
    };
    const rows: Row[] = [];

    for (const c of campaigns) {
      const campaignData = c.data as any;
      const name: string = campaignData?.name ?? c.id;
      const metrics = await getRawMetrics(c.id);
      const byDate = new Map<string, { impressions: number; reach: number; clicks: number; conversions: number; spendCents: number; revenueCents: number }>();
      for (const m of metrics) {
        if (network && m.network !== network) continue;
        const acc = byDate.get(m.date) ?? { impressions: 0, reach: 0, clicks: 0, conversions: 0, spendCents: 0, revenueCents: 0 };
        acc.impressions += m.impressions;
        acc.reach += m.reach;
        acc.clicks += m.clicks;
        acc.conversions += m.conversions;
        acc.spendCents += m.spendCents;
        acc.revenueCents += m.revenueCents ?? 0;
        byDate.set(m.date, acc);
      }
      for (const [date, acc] of byDate) {
        // CRM/Google convention: cost in micros of the currency unit. Polluxa stores spend in cents;
        // 1 cent = 10,000 micros (1 currency unit = 100 cents = 1,000,000 micros). reach/roas are
        // plain counts/ratios, same as impressions/clicks/conversions above — not currency, so no
        // micros conversion applies to them.
        const costMicros = acc.spendCents * 10_000;
        rows.push({
          date,
          id: c.id,
          name,
          metrics: {
            impressions: acc.impressions,
            reach: acc.reach,
            clicks: acc.clicks,
            conversions: acc.conversions,
            cost_micros: costMicros,
            cpm_micros: acc.impressions > 0 ? Math.round((costMicros / acc.impressions) * 1000) : 0,
            cpc_micros: acc.clicks > 0 ? Math.round(costMicros / acc.clicks) : 0,
            roas: acc.spendCents > 0 && acc.revenueCents > 0 ? acc.revenueCents / acc.spendCents : 0,
          },
        });
      }
    }

    res.json({ data: rows });
  })
);

/* ── Audiences ──────────────────────────────────────────────────────────── */

const AUDIENCE_TYPE_LABELS: Record<AudienceType, string> = {
  saved: "Saved Audience",
  custom: "Custom Audience",
  lookalike: "Lookalike Audience",
  interest_group: "Interest Group",
};

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
        type: AUDIENCE_TYPE_LABELS[a.type ?? "saved"],
        platform: a.platform ?? null,
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
        return {
          id: c.id,
          name: d?.name ?? c.id,
          networks: d?.networks ?? [],
          status: d?.status ?? "unknown",
          daily_budget_cents: d?.dailyBudgetCents ?? 0,
          // Real per-platform campaign IDs, set once launchMetaHierarchy/launchGoogleHierarchy
          // actually create the campaign container on that network — empty until launched.
          external_ids: d?.externalIds ?? {},
        };
      }),
    });
  })
);
