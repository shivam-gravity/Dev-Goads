import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";

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

function save(d: Draft) {
  db.prepare("INSERT OR REPLACE INTO drafts (id, workspaceId, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(d.id, d.workspaceId, JSON.stringify(d), d.createdAt, d.updatedAt);
}

export function listDrafts(workspaceId: string): Draft[] {
  const rows = db.prepare("SELECT data FROM drafts WHERE workspaceId = ? ORDER BY updatedAt DESC").all(workspaceId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Draft);
}

export function createDraft(workspaceId: string, input: Pick<Draft, "name" | "type" | "data" | "aiRecommendation" | "score" | "scheduledAt">): Draft {
  const d: Draft = {
    id: randomUUID(),
    workspaceId,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...input,
  };
  save(d);
  return d;
}

export function updateDraft(id: string, patch: Partial<Omit<Draft, "id" | "workspaceId" | "createdAt">>): Draft {
  const row = db.prepare("SELECT data FROM drafts WHERE id = ?").get(id) as { data: string } | undefined;
  if (!row) throw new Error("Draft not found");
  const d: Draft = { ...JSON.parse(row.data), ...patch, updatedAt: new Date().toISOString() };
  save(d);
  return d;
}

export function publishDraft(id: string): Draft {
  return updateDraft(id, { status: "published", publishedAt: new Date().toISOString() });
}

export function deleteDraft(id: string): boolean {
  return db.prepare("DELETE FROM drafts WHERE id = ?").run(id).changes > 0;
}

export function scheduleDraft(id: string, scheduledAt: string): Draft {
  return updateDraft(id, { status: "scheduled", scheduledAt });
}

// Create demo drafts
export function seedDemoDrafts(workspaceId: string) {
  const existing = listDrafts(workspaceId);
  if (existing.length > 0) return;

  const demos = [
    { name: "Black Friday Sale Campaign", type: "campaign" as const, data: { goal: "sales", budget: 5000, platforms: ["meta", "google"], targeting: { age: [25, 45], interests: ["shopping", "deals"] } }, aiRecommendation: "Strong seasonal timing. Consider increasing budget by 20% based on historical Black Friday performance in your category. Running Nov 22-30 recommended.", score: 87 },
    { name: "Brand Awareness Q4", type: "campaign" as const, data: { goal: "awareness", budget: 3000, platforms: ["meta"], targeting: { age: [18, 35], locations: ["New York", "Los Angeles"] } }, aiRecommendation: "Video creatives recommended for awareness campaigns. Your target demo shows 3× higher engagement with short-form video content.", score: 72 },
    { name: "Retargeting — Cart Abandoners", type: "ad_set" as const, data: { audience: "cart_abandoners", budget: 800, bidStrategy: "lowest_cost", placements: ["feed", "stories"] }, aiRecommendation: "High intent audience — expect 4-6× ROAS. Add urgency in your copy ('Only 3 left!') to improve conversion rate.", score: 91 },
  ];

  for (const d of demos) {
    createDraft(workspaceId, d);
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

function saveAdSet(a: AdSet) { db.prepare("INSERT OR REPLACE INTO ad_sets (id, campaignId, workspaceId, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(a.id, a.campaignId, a.workspaceId ?? null, JSON.stringify(a), a.createdAt, a.updatedAt); }
function saveAd(a: Ad) { db.prepare("INSERT OR REPLACE INTO ads (id, adSetId, workspaceId, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(a.id, a.adSetId, a.workspaceId ?? null, JSON.stringify(a), a.createdAt, a.updatedAt); }

export function listAdSets(campaignId: string): AdSet[] {
  const rows = db.prepare("SELECT data FROM ad_sets WHERE campaignId = ? ORDER BY createdAt DESC").all(campaignId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as AdSet);
}

export function createAdSet(campaignId: string, input: Omit<AdSet, "id" | "campaignId" | "createdAt" | "updatedAt">): AdSet {
  const a: AdSet = { id: randomUUID(), campaignId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...input };
  saveAdSet(a);
  return a;
}

export function listAds(adSetId: string): Ad[] {
  const rows = db.prepare("SELECT data FROM ads WHERE adSetId = ? ORDER BY createdAt DESC").all(adSetId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Ad);
}

export function createAd(adSetId: string, input: Omit<Ad, "id" | "adSetId" | "createdAt" | "updatedAt">): Ad {
  const a: Ad = { id: randomUUID(), adSetId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...input };
  saveAd(a);
  return a;
}

export function updateAd(id: string, patch: Partial<Pick<Ad, "name" | "status" | "creative" | "format">>): Ad {
  const row = db.prepare("SELECT data FROM ads WHERE id = ?").get(id) as { data: string } | undefined;
  if (!row) throw new Error("Ad not found");
  const a: Ad = { ...JSON.parse(row.data), ...patch, updatedAt: new Date().toISOString() };
  saveAd(a);
  return a;
}
