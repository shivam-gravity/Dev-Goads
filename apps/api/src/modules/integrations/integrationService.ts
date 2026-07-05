import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";

export interface Integration {
  id: string;
  workspaceId: string;
  platform: "meta" | "google" | "tiktok" | "shopify" | "pixel";
  status: "connected" | "disconnected" | "error" | "pending";
  accountName?: string;
  accountId?: string;
  permissions: string[];
  settings: Record<string, unknown>;
  connectedAt?: string;
  errorMessage?: string;
  updatedAt: string;
}

const DEFAULT_INTEGRATIONS: Omit<Integration, "id" | "workspaceId" | "updatedAt">[] = [
  { platform: "meta", status: "disconnected", permissions: ["ads_management", "ads_read", "business_management"], settings: {} },
  { platform: "google", status: "disconnected", permissions: ["https://www.googleapis.com/auth/adwords"], settings: {} },
  { platform: "tiktok", status: "disconnected", permissions: ["ad.read", "campaign.read", "report.read"], settings: {} },
  { platform: "shopify", status: "disconnected", permissions: ["read_products", "read_orders", "read_customers"], settings: {} },
  { platform: "pixel", status: "disconnected", permissions: [], settings: { pixelId: "", events: [] } },
];

function save(i: Integration) {
  db.prepare("INSERT OR REPLACE INTO integrations (id, workspaceId, platform, data, updatedAt) VALUES (?, ?, ?, ?, ?)").run(i.id, i.workspaceId, i.platform, JSON.stringify(i), i.updatedAt);
}

export function getOrCreateIntegrations(workspaceId: string): Integration[] {
  const rows = db.prepare("SELECT data FROM integrations WHERE workspaceId = ?").all(workspaceId) as { data: string }[];
  if (rows.length > 0) return rows.map((r) => JSON.parse(r.data) as Integration);

  const integrations = DEFAULT_INTEGRATIONS.map((d) => ({ ...d, id: randomUUID(), workspaceId, updatedAt: new Date().toISOString() } as Integration));
  for (const i of integrations) save(i);
  return integrations;
}

export function connectIntegration(workspaceId: string, platform: Integration["platform"], mockAccountName: string): Integration {
  const rows = db.prepare("SELECT data FROM integrations WHERE workspaceId = ? AND platform = ?").all(workspaceId, platform) as { data: string }[];
  const existing = rows[0] ? JSON.parse(rows[0].data) as Integration : DEFAULT_INTEGRATIONS.find((d) => d.platform === platform)!;

  const updated: Integration = {
    ...existing,
    id: (rows[0] ? JSON.parse(rows[0].data) : {}).id ?? randomUUID(),
    workspaceId,
    status: "connected",
    accountName: mockAccountName,
    accountId: `act_${Math.floor(Math.random() * 9000000) + 1000000}`,
    connectedAt: new Date().toISOString(),
    errorMessage: undefined,
    updatedAt: new Date().toISOString(),
  };
  save(updated);
  return updated;
}

export function disconnectIntegration(workspaceId: string, platform: Integration["platform"]): Integration {
  const rows = db.prepare("SELECT data FROM integrations WHERE workspaceId = ? AND platform = ?").all(workspaceId, platform) as { data: string }[];
  if (!rows[0]) throw new Error("Integration not found");
  const existing = JSON.parse(rows[0].data) as Integration;
  const updated: Integration = { ...existing, status: "disconnected", accountName: undefined, accountId: undefined, connectedAt: undefined, updatedAt: new Date().toISOString() };
  save(updated);
  return updated;
}

export function updateIntegrationSettings(workspaceId: string, platform: Integration["platform"], settings: Record<string, unknown>): Integration {
  const rows = db.prepare("SELECT data FROM integrations WHERE workspaceId = ? AND platform = ?").all(workspaceId, platform) as { data: string }[];
  if (!rows[0]) throw new Error("Integration not found");
  const existing = JSON.parse(rows[0].data) as Integration;
  const updated: Integration = { ...existing, settings: { ...existing.settings, ...settings }, updatedAt: new Date().toISOString() };
  save(updated);
  return updated;
}
