import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { encryptToken, decryptToken } from "../../infra/crypto.js";

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

export interface MetaOAuthConnectionInput {
  accessToken: string;
  expiresInSeconds: number;
  adAccountId: string;
  adAccountName: string;
  currency: string;
  pageId?: string;
  pageName?: string;
}

/** Persists a real Meta OAuth connection (encrypted token) after metaOAuth.ts completes the handshake. */
export async function setMetaOAuthConnection(workspaceId: string, input: MetaOAuthConnectionInput): Promise<Integration> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform: "meta" } });
  const existing = row ? (row.data as unknown as Integration) : DEFAULT_INTEGRATIONS.find((d) => d.platform === "meta")!;

  const updated: Integration = {
    ...existing,
    id: row?.id ?? randomUUID(),
    workspaceId,
    platform: "meta",
    status: "connected",
    accountName: input.adAccountName,
    accountId: input.adAccountId,
    connectedAt: new Date().toISOString(),
    errorMessage: undefined,
    settings: {
      ...existing.settings,
      accessTokenEncrypted: encryptToken(input.accessToken),
      tokenExpiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      currency: input.currency,
      pageId: input.pageId,
      pageName: input.pageName,
    },
    updatedAt: new Date().toISOString(),
  };
  await save(updated);
  return updated;
}

export interface MetaCredentials {
  accessToken: string;
  adAccountId: string;
  pageId?: string;
  /** Ad account's billing currency (e.g. "USD", "JPY") — Meta's minor-unit conversion varies by currency (see metaAdapter's currency divisor table). */
  currency: string;
}

/** Decrypts and returns the connected Meta ad account's live token, or null if not connected via real OAuth. */
export async function getMetaCredentials(workspaceId: string): Promise<MetaCredentials | null> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform: "meta" } });
  if (!row) return null;
  const integration = row.data as unknown as Integration;
  const tokenEncrypted = integration.settings?.accessTokenEncrypted as string | undefined;
  if (integration.status !== "connected" || !tokenEncrypted || !integration.accountId) return null;
  return {
    accessToken: decryptToken(tokenEncrypted),
    adAccountId: integration.accountId,
    pageId: integration.settings?.pageId as string | undefined,
    currency: (integration.settings?.currency as string | undefined) ?? "USD",
  };
}

export interface GoogleOAuthConnectionInput {
  refreshToken: string;
  accessToken: string;
  expiresInSeconds: number;
  customerId: string;
  customerName?: string;
}

/** Persists a real Google OAuth connection (encrypted tokens) after googleOAuth.ts completes the handshake. */
export async function setGoogleOAuthConnection(workspaceId: string, input: GoogleOAuthConnectionInput): Promise<Integration> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform: "google" } });
  const existing = row ? (row.data as unknown as Integration) : DEFAULT_INTEGRATIONS.find((d) => d.platform === "google")!;

  const updated: Integration = {
    ...existing,
    id: row?.id ?? randomUUID(),
    workspaceId,
    platform: "google",
    status: "connected",
    accountName: input.customerName ?? `Customer ${input.customerId}`,
    accountId: input.customerId,
    connectedAt: new Date().toISOString(),
    errorMessage: undefined,
    settings: {
      ...existing.settings,
      refreshTokenEncrypted: encryptToken(input.refreshToken),
      accessTokenEncrypted: encryptToken(input.accessToken),
      tokenExpiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  await save(updated);
  return updated;
}

export interface RawGoogleTokenData {
  refreshToken: string;
  accessToken: string;
  tokenExpiresAt: string;
  customerId: string;
}

/**
 * Raw (still-encrypted-until-here) token read, with no refresh logic — Google access
 * tokens expire hourly and refreshing requires calling Google's token endpoint, which
 * would create a circular import if it lived here (googleOAuth.ts already imports this
 * module to persist connections). See googleOAuth.getGoogleAdsCredentials for the
 * refresh-aware wrapper that callers should actually use.
 */
export async function getRawGoogleTokenData(workspaceId: string): Promise<RawGoogleTokenData | null> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform: "google" } });
  if (!row) return null;
  const integration = row.data as unknown as Integration;
  const refreshTokenEncrypted = integration.settings?.refreshTokenEncrypted as string | undefined;
  const accessTokenEncrypted = integration.settings?.accessTokenEncrypted as string | undefined;
  if (integration.status !== "connected" || !refreshTokenEncrypted || !accessTokenEncrypted || !integration.accountId) return null;
  return {
    refreshToken: decryptToken(refreshTokenEncrypted),
    accessToken: decryptToken(accessTokenEncrypted),
    tokenExpiresAt: integration.settings?.tokenExpiresAt as string,
    customerId: integration.accountId,
  };
}

/** Updates just the access token + expiry after a refresh — refreshToken/customerId are untouched. */
export async function updateGoogleAccessToken(workspaceId: string, accessToken: string, expiresInSeconds: number): Promise<void> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform: "google" } });
  if (!row) throw new Error("Google integration not found");
  const existing = row.data as unknown as Integration;
  const updated: Integration = {
    ...existing,
    settings: {
      ...existing.settings,
      accessTokenEncrypted: encryptToken(accessToken),
      tokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  await save(updated);
}
