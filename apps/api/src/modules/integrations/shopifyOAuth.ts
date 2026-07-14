import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../logger/logger.js";
import { setShopifyOAuthConnection, getRawShopifyTokenData, updateShopifyAccessToken } from "./integrationService.js";

// Confirmed against Shopify's current (2026) developer docs rather than assumed from
// training data — see the OAuth flow doc and the "Offline access tokens now support expiry
// and refresh" changelog entry. As of April 1, 2026 Shopify requires all public apps to use
// EXPIRING offline access tokens (60min access token, 90-day refresh token) rather than the
// old permanent-token model — this file's refresh logic mirrors googleOAuth.ts's
// access-token-expiry-refresh pattern for exactly that reason, unlike metaOAuth.ts's
// permanent-token model.
const SHOPIFY_APP_CLIENT_ID = process.env.SHOPIFY_APP_CLIENT_ID;
const SHOPIFY_APP_CLIENT_SECRET = process.env.SHOPIFY_APP_CLIENT_SECRET;
const SHOPIFY_OAUTH_REDIRECT_URI = process.env.SHOPIFY_OAUTH_REDIRECT_URI ?? "http://localhost:4000/api/integrations/shopify/oauth/callback";
const SHOPIFY_SCOPES = "read_products,read_orders,read_customers";

export const hasLiveShopifyAppCredentials = Boolean(SHOPIFY_APP_CLIENT_ID && SHOPIFY_APP_CLIENT_SECRET);

// Refresh proactively this far ahead of actual expiry, same margin as googleOAuth.ts.
const REFRESH_SKEW_MS = 2 * 60 * 1000;

function normalizeShopDomain(shop: string): string {
  const trimmed = shop.trim().toLowerCase();
  return trimmed.endsWith(".myshopify.com") ? trimmed : `${trimmed}.myshopify.com`;
}

/** Starts the app-install flow for a specific merchant store — `shop` is the merchant's own
 * *.myshopify.com domain, supplied by the merchant (e.g. typed into a "Connect your store"
 * field), not chosen by us the way Meta/Google's single global app-authorization dialog is. */
export function getShopifyInstallUrl(shop: string, state: string): string {
  const shopDomain = normalizeShopDomain(shop);
  const params = new URLSearchParams({
    client_id: SHOPIFY_APP_CLIENT_ID ?? "",
    scope: SHOPIFY_SCOPES,
    redirect_uri: SHOPIFY_OAUTH_REDIRECT_URI,
    state,
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Verifies Shopify's own HMAC scheme over the OAuth callback's query string — distinct from
 * the webhook HMAC scheme in shopifyWebhookRoutes.ts (that one signs the raw request body;
 * this one signs the query params themselves, sorted, joined, hex-encoded not base64).
 */
export function isValidCallbackHmac(query: Record<string, string | undefined>): boolean {
  if (!SHOPIFY_APP_CLIENT_SECRET) {
    logger.warn("SHOPIFY_APP_CLIENT_SECRET not set — rejecting Shopify OAuth callback (cannot verify HMAC)");
    return false;
  }
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .filter((key) => rest[key] !== undefined)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("&");

  const expected = createHmac("sha256", SHOPIFY_APP_CLIENT_SECRET).update(message).digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface ShopifyTokenResponse {
  accessToken: string;
  scope: string;
  expiresIn?: number;
  refreshToken?: string;
  refreshTokenExpiresIn?: number;
}

async function exchangeCodeForToken(shop: string, code: string): Promise<ShopifyTokenResponse> {
  const shopDomain = normalizeShopDomain(shop);
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_APP_CLIENT_ID,
      client_secret: SHOPIFY_APP_CLIENT_SECRET,
      code,
      // Required to get an expiring token + refresh token under Shopify's 2026 policy —
      // omitting this would silently request the deprecated permanent-token behavior.
      expiring: 1,
    }),
  });
  const json = (await res.json()) as any;
  if (!res.ok || !json.access_token) {
    throw new Error(`Shopify token exchange failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return {
    accessToken: json.access_token,
    scope: json.scope,
    expiresIn: json.expires_in,
    refreshToken: json.refresh_token,
    refreshTokenExpiresIn: json.refresh_token_expires_in,
  };
}

async function refreshAccessToken(shop: string, refreshToken: string): Promise<ShopifyTokenResponse> {
  const shopDomain = normalizeShopDomain(shop);
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_APP_CLIENT_ID,
      client_secret: SHOPIFY_APP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json = (await res.json()) as any;
  if (!res.ok || !json.access_token) {
    throw new Error(`Shopify token refresh failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return {
    accessToken: json.access_token,
    scope: json.scope,
    expiresIn: json.expires_in,
    refreshToken: json.refresh_token,
    refreshTokenExpiresIn: json.refresh_token_expires_in,
  };
}

/**
 * Completes the app-install handshake: verifies the callback's HMAC, exchanges the code for
 * an expiring access token + refresh token, and persists them per-workspace (encrypted). No
 * mock-connect fallback here unlike Meta/Google/TikTok — those are single-app-wide OAuth
 * dialogs that make sense to stub with a fake "connected" state when unconfigured; Shopify's
 * flow is inherently per-merchant-store (there's no single dialog to redirect to without a
 * specific `shop` already in hand), so "not configured" is a real error to surface, not a
 * demo-mode fallback.
 */
export async function handleShopifyOAuthCallback(workspaceId: string, shop: string, code: string): Promise<void> {
  if (!hasLiveShopifyAppCredentials) {
    throw new Error("SHOPIFY_APP_CLIENT_ID/SHOPIFY_APP_CLIENT_SECRET not configured — cannot complete a real Shopify app install");
  }
  const token = await exchangeCodeForToken(shop, code);
  await setShopifyOAuthConnection(workspaceId, {
    shopDomain: normalizeShopDomain(shop),
    accessToken: token.accessToken,
    expiresInSeconds: token.expiresIn ?? 60 * 60,
    refreshToken: token.refreshToken,
    refreshTokenExpiresInSeconds: token.refreshTokenExpiresIn,
  });
}

export interface ShopifyCredentials {
  shopDomain: string;
  accessToken: string;
}

/**
 * Returns a valid (refreshed if needed) access token for the workspace's connected Shopify
 * store, or null if not connected. Mirrors googleOAuth.getGoogleAdsCredentials's
 * refresh-aware wrapper exactly, since Shopify's expiring-token model (as of April 2026) now
 * has the same "access token expires in ~1hr, refresh it via the refresh token" shape Google
 * already has — unlike Meta's long-lived-token model.
 */
export async function getShopifyCredentials(workspaceId: string): Promise<ShopifyCredentials | null> {
  const raw = await getRawShopifyTokenData(workspaceId);
  if (!raw) return null;

  if (!raw.refreshToken) {
    // A store connected before this workspace ever had expiring tokens (or Shopify's legacy
    // permanent-token model) — no refresh possible, use as-is until it fails upstream.
    return { shopDomain: raw.shopDomain, accessToken: raw.accessToken };
  }

  const expiresAt = new Date(raw.tokenExpiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return { shopDomain: raw.shopDomain, accessToken: raw.accessToken };
  }

  const refreshed = await refreshAccessToken(raw.shopDomain, raw.refreshToken);
  await updateShopifyAccessToken(workspaceId, refreshed.accessToken, refreshed.expiresIn ?? 60 * 60, refreshed.refreshToken);
  return { shopDomain: raw.shopDomain, accessToken: refreshed.accessToken };
}
