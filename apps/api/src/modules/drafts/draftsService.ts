import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { llm, runText } from "../../infra/llmClient.js";
import { logger } from "../logger/logger.js";

export interface Draft {
  id: string;
  workspaceId: string;
  name: string;
  type: "campaign" | "ad_set" | "ad";
  status: "draft" | "review" | "scheduled" | "published";
  data: Record<string, unknown>;
  aiRecommendation?: string;
  score?: number;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

async function generateAiRecommendation(name: string, type: Draft["type"], data: Record<string, unknown>): Promise<string | undefined> {
  if (!llm) return undefined;
  try {
    const reply = await runText({
      maxTokens: 220,
      system: "You are an ad strategist reviewing a draft campaign before launch. In 2-3 sentences, give one concrete, specific recommendation to improve performance (budget, targeting, creative, or timing). Be direct and reference real numbers/details from the draft when present. No preamble.",
      messages: [{ role: "user", content: `Draft name: ${name}\nType: ${type}\nDetails: ${JSON.stringify(data)}` }],
    });
    return reply?.trim() || undefined;
  } catch (err) {
    logger.error("Failed to generate draft AI recommendation", err);
    return undefined;
  }
}

async function save(d: Draft): Promise<void> {
  await prisma.draft.upsert({
    where: { id: d.id },
    create: { id: d.id, workspaceId: d.workspaceId, data: d as any, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) },
    update: { data: d as any, updatedAt: new Date(d.updatedAt) },
  });
}

export async function listDrafts(workspaceId: string): Promise<Draft[]> {
  const rows = await prisma.draft.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
  return rows.map((r) => r.data as unknown as Draft);
}

export async function createDraft(workspaceId: string, input: Pick<Draft, "name" | "type" | "data" | "aiRecommendation" | "score" | "scheduledAt">): Promise<Draft> {
  const aiRecommendation = input.aiRecommendation ?? (await generateAiRecommendation(input.name, input.type, input.data));
  const d: Draft = {
    id: randomUUID(),
    workspaceId,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...input,
    aiRecommendation,
  };
  await save(d);
  return d;
}

export async function updateDraft(id: string, patch: Partial<Omit<Draft, "id" | "workspaceId" | "createdAt">>): Promise<Draft> {
  const row = await prisma.draft.findUnique({ where: { id } });
  if (!row) throw new Error("Draft not found");
  const existing = row.data as unknown as Draft;
  const aiRecommendation = patch.aiRecommendation ?? (patch.data ? await generateAiRecommendation(patch.name ?? existing.name, existing.type, patch.data) : existing.aiRecommendation);
  const d: Draft = { ...existing, ...patch, aiRecommendation, updatedAt: new Date().toISOString() };
  await save(d);
  return d;
}

export async function publishDraft(id: string): Promise<Draft> {
  return updateDraft(id, { status: "published", publishedAt: new Date().toISOString() });
}

export async function deleteDraft(id: string): Promise<boolean> {
  const result = await prisma.draft.deleteMany({ where: { id } });
  return result.count > 0;
}

export async function scheduleDraft(id: string, scheduledAt: string): Promise<Draft> {
  return updateDraft(id, { status: "scheduled", scheduledAt });
}

// Create demo drafts
export async function seedDemoDrafts(workspaceId: string): Promise<void> {
  const existing = await listDrafts(workspaceId);
  if (existing.length > 0) return;

  const demos = [
    { name: "Black Friday Sale Campaign", type: "campaign" as const, data: { goal: "sales", budget: 5000, platforms: ["meta", "google"], targeting: { age: [25, 45], interests: ["shopping", "deals"] } }, aiRecommendation: "Strong seasonal timing. Consider increasing budget by 20% based on historical Black Friday performance in your category. Running Nov 22-30 recommended.", score: 87 },
    { name: "Brand Awareness Q4", type: "campaign" as const, data: { goal: "awareness", budget: 3000, platforms: ["meta"], targeting: { age: [18, 35], locations: ["New York", "Los Angeles"] } }, aiRecommendation: "Video creatives recommended for awareness campaigns. Your target demo shows 3× higher engagement with short-form video content.", score: 72 },
    { name: "Retargeting — Cart Abandoners", type: "ad_set" as const, data: { audience: "cart_abandoners", budget: 800, bidStrategy: "lowest_cost", placements: ["feed", "stories"] }, aiRecommendation: "High intent audience — expect 4-6× ROAS. Add urgency in your copy ('Only 3 left!') to improve conversion rate.", score: 91 },
  ];

  for (const d of demos) {
    await createDraft(workspaceId, d);
  }
}

// Ad sets & Ads (mini service here)
export interface AdSet {
  id: string;
  campaignId: string;
  workspaceId?: string;
  name: string;
  status: "active" | "paused" | "draft";
  dailyBudgetCents: number;
  targeting: Record<string, unknown>;
  placements: string[];
  bidStrategy: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ad {
  id: string;
  adSetId: string;
  workspaceId?: string;
  name: string;
  status: "active" | "paused" | "draft" | "rejected";
  creative: { headline: string; body: string; callToAction: string; imageUrl?: string };
  format: "single_image" | "carousel" | "video" | "collection";
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

async function saveAdSet(a: AdSet): Promise<void> {
  await prisma.adSet.upsert({
    where: { id: a.id },
    create: { id: a.id, campaignId: a.campaignId, workspaceId: a.workspaceId ?? null, data: a as any, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) },
    update: { data: a as any, updatedAt: new Date(a.updatedAt) },
  });
}

async function saveAd(a: Ad): Promise<void> {
  await prisma.ad.upsert({
    where: { id: a.id },
    create: { id: a.id, adSetId: a.adSetId, workspaceId: a.workspaceId ?? null, data: a as any, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) },
    update: { data: a as any, updatedAt: new Date(a.updatedAt) },
  });
}

export async function listAdSets(campaignId: string): Promise<AdSet[]> {
  const rows = await prisma.adSet.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as AdSet);
}

export async function createAdSet(campaignId: string, input: Omit<AdSet, "id" | "campaignId" | "createdAt" | "updatedAt">): Promise<AdSet> {
  const a: AdSet = { id: randomUUID(), campaignId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...input };
  await saveAdSet(a);
  return a;
}

export async function listAds(adSetId: string): Promise<Ad[]> {
  const rows = await prisma.ad.findMany({ where: { adSetId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as Ad);
}

export async function createAd(adSetId: string, input: Omit<Ad, "id" | "adSetId" | "createdAt" | "updatedAt">): Promise<Ad> {
  const a: Ad = { id: randomUUID(), adSetId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...input };
  await saveAd(a);
  return a;
}

export async function updateAd(id: string, patch: Partial<Pick<Ad, "name" | "status" | "creative" | "format">>): Promise<Ad> {
  const row = await prisma.ad.findUnique({ where: { id } });
  if (!row) throw new Error("Ad not found");
  const a: Ad = { ...(row.data as unknown as Ad), ...patch, updatedAt: new Date().toISOString() };
  await saveAd(a);
  return a;
}

/**
 * Minimal shape of a launched campaign variant this sync needs — mirrors the CampaignVariant fields
 * populated by launchMetaHierarchy/launchGoogleHierarchy, kept local so draftsService doesn't depend
 * on the orchestrator's types.
 */
interface LaunchedVariantLike {
  id: string;
  network: string;
  status: string;
  externalId?: string;
  adSetExternalId?: string;
  audienceName?: string;
  creative: { headline: string; body: string; callToAction: string; imageUrl?: string; videoUrl?: string };
}

/**
 * Mirror a just-launched campaign's platform hierarchy into the AdSet/Ad tables the Ads Manager
 * reads. The launch flow writes real Meta/Google ad-set + ad ids onto the campaign's `variants`
 * JSON, but the Ads Manager lists prisma.adSet/prisma.ad rows — so a published campaign showed an
 * empty "Total Ads 0 / Ad Sets 0" hierarchy. This bridges the two: one AdSet row per distinct
 * `adSetExternalId`, one Ad row per launched variant under it.
 *
 * Idempotent: row ids are derived deterministically from the campaign + external ids, so re-running
 * a launch upserts in place instead of duplicating. Skips variants that never launched (no
 * externalId/adSetExternalId — e.g. failed or skipped networks), so nothing invented appears.
 */
export async function syncLaunchedHierarchy(
  campaignId: string,
  workspaceId: string | undefined,
  variants: LaunchedVariantLike[],
): Promise<{ adSets: number; ads: number }> {
  const now = new Date().toISOString();
  const launched = variants.filter((v) => v.externalId && v.adSetExternalId);
  const seenAdSets = new Set<string>();
  let adSetCount = 0;
  let adCount = 0;

  for (const v of launched) {
    const adSetRowId = `launched-${campaignId}-${v.adSetExternalId}`;
    const status: "active" | "paused" | "draft" = v.status === "active" ? "active" : v.status === "paused" ? "paused" : "draft";

    if (!seenAdSets.has(adSetRowId)) {
      seenAdSets.add(adSetRowId);
      await saveAdSet({
        id: adSetRowId,
        campaignId,
        workspaceId,
        name: v.audienceName ? v.audienceName.slice(0, 80) : `Ad set ${v.adSetExternalId}`,
        status,
        dailyBudgetCents: 0, // budget lives at campaign/variant level; ad-set figure is set by the platform
        targeting: {},
        placements: [],
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        createdAt: now,
        updatedAt: now,
      });
      adSetCount++;
    }

    await saveAd({
      id: `launched-${campaignId}-${v.externalId}`,
      adSetId: adSetRowId,
      workspaceId,
      name: `${v.network} · ${(v.creative.headline || v.id).slice(0, 60)}`,
      status,
      creative: {
        headline: v.creative.headline,
        body: v.creative.body,
        callToAction: v.creative.callToAction,
        imageUrl: v.creative.imageUrl,
      },
      format: v.creative.videoUrl ? "video" : "single_image",
      externalId: v.externalId,
      createdAt: now,
      updatedAt: now,
    });
    adCount++;
  }

  return { adSets: adSetCount, ads: adCount };
}
