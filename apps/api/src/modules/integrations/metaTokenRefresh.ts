import { logger } from "../logger/logger.js";
import { prisma } from "../../db/prisma.js";
import { getMetaCredentials } from "./integrationService.js";
import { encryptToken, decryptToken } from "../../infra/crypto.js";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;

const REFRESH_THRESHOLD_DAYS = 7; // refresh when token has < 7 days left

export interface TokenStatus {
  workspaceId: string;
  isValid: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  needsRefresh: boolean;
}

/**
 * Reads the stored Meta connection, checks if token is within REFRESH_THRESHOLD_DAYS of expiry.
 */
export async function checkTokenExpiry(workspaceId: string): Promise<TokenStatus> {
  const row = await prisma.integration.findFirst({ where: { workspaceId, platform: "meta" } });
  if (!row) {
    return { workspaceId, isValid: false, expiresAt: null, daysRemaining: null, needsRefresh: false };
  }

  const data = row.data as any;
  const tokenExpiresAt = data?.settings?.tokenExpiresAt as string | undefined;

  if (!tokenExpiresAt) {
    return { workspaceId, isValid: false, expiresAt: null, daysRemaining: null, needsRefresh: false };
  }

  const expiresAtDate = new Date(tokenExpiresAt);
  const now = new Date();
  const msRemaining = expiresAtDate.getTime() - now.getTime();
  const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

  return {
    workspaceId,
    isValid: msRemaining > 0,
    expiresAt: tokenExpiresAt,
    daysRemaining,
    needsRefresh: daysRemaining < REFRESH_THRESHOLD_DAYS && msRemaining > 0,
  };
}

/**
 * Exchanges the current long-lived token for a new one via Meta's token exchange endpoint.
 * Updates the stored connection with the new token and new expiry.
 */
export async function refreshMetaToken(workspaceId: string): Promise<{ success: boolean; newExpiresAt?: string; error?: string }> {
  if (!META_APP_ID || !META_APP_SECRET) {
    return { success: false, error: "META_APP_ID or META_APP_SECRET not configured" };
  }

  const credentials = await getMetaCredentials(workspaceId);
  if (!credentials) {
    return { success: false, error: "No valid Meta credentials found for workspace" };
  }

  try {
    const url = `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${credentials.accessToken}`;
    const res = await fetch(url, { method: "GET" });

    if (!res.ok) {
      const errorText = await res.text();
      logger.error(`Meta token refresh failed for workspace ${workspaceId}: ${res.status} ${errorText}`);
      return { success: false, error: `Meta API returned ${res.status}: ${errorText}` };
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number; token_type?: string };

    if (!json.access_token) {
      return { success: false, error: "Meta token exchange response missing access_token" };
    }

    const newToken = json.access_token;
    // Meta long-lived tokens typically expire in 60 days (5184000 seconds)
    const expiresInSeconds = json.expires_in ?? 5184000;
    const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // Update the integration's stored accessToken and expiry
    const integration = await prisma.integration.findFirst({ where: { workspaceId, platform: "meta" } });
    if (integration) {
      const data = integration.data as any;
      data.settings.accessTokenEncrypted = encryptToken(newToken);
      data.settings.tokenExpiresAt = newExpiresAt;
      data.settings.tokenRefreshedAt = new Date().toISOString();
      await prisma.integration.update({ where: { id: integration.id }, data: { data } });
    }

    logger.info(`Meta token refreshed for workspace ${workspaceId}, new expiry: ${newExpiresAt}`);
    return { success: true, newExpiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Meta token refresh error for workspace ${workspaceId}`, err);
    return { success: false, error: message };
  }
}

/**
 * Scans all workspace Meta integrations, refreshes any within threshold.
 * This is what the worker/cron would call.
 */
export async function refreshAllExpiringTokens(): Promise<{ refreshed: string[]; failed: string[]; skipped: string[] }> {
  const refreshed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  const metaIntegrations = await prisma.integration.findMany({ where: { platform: "meta" } });

  for (const row of metaIntegrations) {
    const data = row.data as any;
    const workspaceId = row.workspaceId;

    // Skip disconnected or mock integrations
    if (data?.status !== "connected" || !data?.settings?.accessTokenEncrypted) {
      skipped.push(workspaceId);
      continue;
    }

    const status = await checkTokenExpiry(workspaceId);

    if (!status.isValid) {
      // Token already expired — can't refresh an expired token
      failed.push(workspaceId);
      logger.warn(`Meta token for workspace ${workspaceId} is already expired, cannot refresh`);
      continue;
    }

    if (!status.needsRefresh) {
      skipped.push(workspaceId);
      continue;
    }

    const result = await refreshMetaToken(workspaceId);
    if (result.success) {
      refreshed.push(workspaceId);
    } else {
      failed.push(workspaceId);
      logger.error(`Failed to refresh Meta token for workspace ${workspaceId}: ${result.error}`);
    }
  }

  logger.info(`Meta token refresh sweep complete: ${refreshed.length} refreshed, ${failed.length} failed, ${skipped.length} skipped`);
  return { refreshed, failed, skipped };
}

/**
 * GET /debug_token to get token metadata from Meta — useful for diagnosing token issues.
 */
export async function debugTokenInfo(accessToken: string): Promise<Record<string, unknown> | null> {
  if (!META_APP_ID || !META_APP_SECRET) {
    logger.warn("Cannot debug token: META_APP_ID or META_APP_SECRET not configured");
    return null;
  }

  try {
    const url = `${GRAPH_BASE}/debug_token?input_token=${accessToken}&access_token=${META_APP_ID}|${META_APP_SECRET}`;
    const res = await fetch(url, { method: "GET" });

    if (!res.ok) {
      logger.warn(`Meta debug_token returned ${res.status}`);
      return null;
    }

    const json = (await res.json()) as { data?: Record<string, unknown> };
    return json.data ?? null;
  } catch (err) {
    logger.error("Failed to call Meta debug_token endpoint", err);
    return null;
  }
}
