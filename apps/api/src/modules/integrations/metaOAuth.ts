import { logger } from "../logger/logger.js";
import { connectIntegration, setMetaOAuthConnection } from "./integrationService.js";
import { signOAuthState, verifyOAuthState } from "./oauthState.js";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_OAUTH_REDIRECT_URI = process.env.META_OAUTH_REDIRECT_URI ?? "http://localhost:4000/api/integrations/meta/oauth/callback";

export const hasLiveMetaAppCredentials = Boolean(META_APP_ID && META_APP_SECRET);

export function getMetaAuthUrl(workspaceId: string): string {
  const state = signOAuthState(workspaceId);
  const params = new URLSearchParams({
    client_id: META_APP_ID ?? "",
    redirect_uri: META_OAUTH_REDIRECT_URI,
    scope: "ads_management,ads_read,business_management,pages_show_list,leads_retrieval,pages_manage_ads,pages_read_engagement",
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

/**
 * Entry point for the "Connect" button. With no Meta App registered there's nothing
 * real to redirect to — Facebook would reject an OAuth dialog with a blank client_id —
 * so this completes a mock connect immediately instead of round-tripping through
 * facebook.com. Once META_APP_ID/META_APP_SECRET are set, it returns the real dialog URL.
 */
export async function startMetaConnect(workspaceId: string): Promise<{ redirectUrl: string } | { mockConnected: true }> {
  if (!hasLiveMetaAppCredentials) {
    logger.warn("META_APP_ID/META_APP_SECRET not set — mock-connecting Meta instead of redirecting to Facebook");
    await connectIntegration(workspaceId, "meta", "AdGo Meta Business Manager (mock)");
    return { mockConnected: true };
  }
  return { redirectUrl: getMetaAuthUrl(workspaceId) };
}

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const url = `${GRAPH_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    // error_user_msg is Meta's own user-facing message when present — prefer it over
    // the developer-facing `message` field (same precedence a proven reference impl uses).
    throw new Error(`Meta Graph API error on ${path}: ${json.error?.error_user_msg ?? json.error?.message ?? res.status}`);
  }
  return json;
}

async function exchangeCodeForShortLivedToken(code: string): Promise<{ accessToken: string; expiresIn: number }> {
  const json = await graphGet("/oauth/access_token", {
    client_id: META_APP_ID ?? "",
    client_secret: META_APP_SECRET ?? "",
    redirect_uri: META_OAUTH_REDIRECT_URI,
    code,
  });
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const json = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID ?? "",
    client_secret: META_APP_SECRET ?? "",
    fb_exchange_token: shortLivedToken,
  });
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 60 * 60 * 24 * 60 };
}

const ACCOUNT_STATUS_LABELS: Record<number, string> = { 1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "CLOSED", 201: "ANY_ACTIVE", 202: "ANY_CLOSED" };

async function fetchFirstAdAccount(accessToken: string): Promise<{ id: string; name: string; currency: string; timezoneName?: string; accountStatus?: string } | null> {
  const json = await graphGet("/me/adaccounts", { fields: "id,name,currency,timezone_name,account_status", access_token: accessToken });
  const first = (json.data ?? [])[0];
  if (!first) return null;
  return {
    id: first.id,
    name: first.name,
    currency: first.currency ?? "USD",
    timezoneName: first.timezone_name,
    accountStatus: ACCOUNT_STATUS_LABELS[first.account_status] ?? undefined,
  };
}

async function fetchFirstPage(accessToken: string): Promise<{ id: string; name: string } | null> {
  const json = await graphGet("/me/accounts", { fields: "id,name", access_token: accessToken });
  const first = (json.data ?? [])[0];
  return first ? { id: first.id, name: first.name } : null;
}

/**
 * Completes the OAuth handshake: code -> short-lived token -> long-lived token,
 * then picks the first ad account + Page the user granted access to (multi-account
 * picker is a follow-up; today's Integration model holds one connection per platform).
 * Falls back to the existing mock connect when no Meta App is registered, so local
 * dev keeps working without real credentials.
 */
export async function handleMetaOAuthCallback(code: string, state: string): Promise<{ workspaceId: string }> {
  const { workspaceId } = verifyOAuthState(state);

  if (!hasLiveMetaAppCredentials) {
    logger.warn("META_APP_ID/META_APP_SECRET not set — completing Meta OAuth callback with mock connect");
    await connectIntegration(workspaceId, "meta", "AdGo Meta Business Manager (mock)");
    return { workspaceId };
  }

  const shortLived = await exchangeCodeForShortLivedToken(code);
  const longLived = await exchangeForLongLivedToken(shortLived.accessToken);
  const [adAccount, page] = await Promise.all([
    fetchFirstAdAccount(longLived.accessToken),
    fetchFirstPage(longLived.accessToken),
  ]);

  if (!adAccount) throw new Error("No ad account found on this Meta user — grant access to at least one ad account and retry");

  await setMetaOAuthConnection(workspaceId, {
    accessToken: longLived.accessToken,
    expiresInSeconds: longLived.expiresIn,
    adAccountId: adAccount.id,
    adAccountName: adAccount.name,
    currency: adAccount.currency,
    timezoneName: adAccount.timezoneName,
    accountStatus: adAccount.accountStatus,
    pageId: page?.id,
    pageName: page?.name,
  });

  return { workspaceId };
}
