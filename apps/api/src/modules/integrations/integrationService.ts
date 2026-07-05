import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export interface Integration {
  id: string;
  workspaceId: string;
  platform: "meta" | "google" | "tiktok" | "shopify" | "woocommerce" | "pixel";
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
  { platform: "woocommerce", status: "disconnected", permissions: ["read_products", "read_orders"], settings: {} },
  { platform: "pixel", status: "disconnected", permissions: [], settings: { pixelId: "", events: [] } },
];

async function save(i: Integration): Promise<void> {
  await prisma.integration.upsert({
    where: { id: i.id },
    create: { id: i.id, workspaceId: i.workspaceId, platform: i.platform, data: i as any, updatedAt: new Date(i.updatedAt) },
    update: { data: i as any, updatedAt: new Date(i.updatedAt) },
  });
}

export async function getOrCreateIntegrations(workspaceId: string): Promise<Integration[]> {
  const rows = await prisma.integration.findMany({ where: { workspaceId } });
  if (rows.length > 0) return rows.map((r) => r.data as unknown as Integration);

  const integrations = DEFAULT_INTEGRATIONS.map((d) => ({ ...d, id: randomUUID(), workspaceId, updatedAt: new Date().toISOString() } as Integration));
  for (const i of integrations) await save(i);
  return integrations;
}

export async function connectIntegration(workspaceId: string, platform: Integration["platform"], mockAccountName: string): Promise<Integration> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform } });
  const existing = row ? (row.data as unknown as Integration) : DEFAULT_INTEGRATIONS.find((d) => d.platform === platform)!;

  const updated: Integration = {
    ...existing,
    id: row?.id ?? randomUUID(),
    workspaceId,
    status: "connected",
    accountName: mockAccountName,
    accountId: `act_${Math.floor(Math.random() * 9000000) + 1000000}`,
    connectedAt: new Date().toISOString(),
    errorMessage: undefined,
    updatedAt: new Date().toISOString(),
  };
  await save(updated);
  return updated;
}

export async function disconnectIntegration(workspaceId: string, platform: Integration["platform"]): Promise<Integration> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform } });
  if (!row) throw new Error("Integration not found");
  const existing = row.data as unknown as Integration;
  const updated: Integration = { ...existing, id: row.id, status: "disconnected", accountName: undefined, accountId: undefined, connectedAt: undefined, updatedAt: new Date().toISOString() };
  await save(updated);
  return updated;
}

export async function updateIntegrationSettings(workspaceId: string, platform: Integration["platform"], settings: Record<string, unknown>): Promise<Integration> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform } });
  if (!row) throw new Error("Integration not found");
  const existing = row.data as unknown as Integration;
  const updated: Integration = { ...existing, id: row.id, settings: { ...existing.settings, ...settings }, updatedAt: new Date().toISOString() };
  await save(updated);
  return updated;
}
