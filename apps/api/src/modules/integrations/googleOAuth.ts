import { logger } from "../logger/logger.js";
import {
  connectIntegration,
  setGoogleOAuthConnection,
  getRawGoogleTokenData,
  updateGoogleAccessToken,
} from "./integrationService.js";
import { signOAuthState, verifyOAuthState } from "./oauthState.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ADS_API_VERSION = "v24";

const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://localhost:4000/api/integrations/google/oauth/callback";
const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

// A developer token is also required to actually call the Ads API (not just OAuth), unlike
// Meta where the App credentials alone are enough to complete the handshake.
export const hasLiveGoogleAppCredentials = Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_ADS_DEVELOPER_TOKEN);

// Refresh proactively this far ahead of actual expiry to avoid a request racing the clock.
const REFRESH_SKEW_MS = 2 * 60 * 1000;

export function getGoogleAuthUrl(workspaceId: string): string {
  const state = signOAuthState(workspaceId);
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Entry point for the "Connect" button. Same shape as metaOAuth.startMetaConnect: with no
 * Google OAuth client (or no developer token) registered, there's nothing real to redirect
 * to, so this mock-connects immediately instead of sending the user to a broken consent screen.
 */
export async function startGoogleConnect(workspaceId: string): Promise<{ redirectUrl: string } | { mockConnected: true }> {
  if (!hasLiveGoogleAppCredentials) {
    logger.warn("Google OAuth client/developer token not set — mock-connecting Google instead of redirecting");
    await connectIntegration(workspaceId, "google", "AdGo Google Ads MCC (mock)");
    return { mockConnected: true };
  }
  return { redirectUrl: getGoogleAuthUrl(workspaceId) };
}

async function exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as any;
  if (!res.ok || !json.access_token) throw new Error(`Google token exchange failed: ${json.error_description ?? res.status}`);
  if (!json.refresh_token) {
    throw new Error("Google did not return a refresh token — remove AdGo's access at myaccount.google.com/permissions and reconnect (offline access is only granted on first consent)");
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in ?? 3600 };
}

/** clientId/clientSecret default to the global OAuth app's credentials, but a manually-connected integration can supply its own (see setGoogleManualConnection) — those take precedence since the refresh token was issued against that client, not necessarily AdGo's registered app. */
async function refreshAccessToken(refreshToken: string, clientId?: string, clientSecret?: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId ?? GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: clientSecret ?? GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as any;
  if (!res.ok || !json.access_token) throw new Error(`Google token refresh failed: ${json.error_description ?? res.status}`);
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

async function fetchFirstAccessibleCustomer(accessToken: string): Promise<string | null> {
  const res = await fetch(`https://googleads.googleapis.com/${ADS_API_VERSION}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN ?? "" },
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Failed to list accessible Google Ads customers: ${JSON.stringify(json)}`);
  const resourceName = (json.resourceNames ?? [])[0] as string | undefined;
  return resourceName ? resourceName.replace("customers/", "") : null;
}

/**
 * Completes the OAuth handshake: code -> access+refresh token, then picks the first
 * accessible Google Ads customer account (multi-account picker is a follow-up, same as
 * Meta's ad-account selection). Falls back to mock connect when no OAuth client is
 * registered, so local dev keeps working without real credentials.
 */
export async function handleGoogleOAuthCallback(code: string, state: string): Promise<{ workspaceId: string }> {
  const { workspaceId } = verifyOAuthState(state);

  if (!hasLiveGoogleAppCredentials) {
    logger.warn("Google OAuth client/developer token not set — completing Google OAuth callback with mock connect");
    await connectIntegration(workspaceId, "google", "AdGo Google Ads MCC (mock)");
    return { workspaceId };
  }

  const tokens = await exchangeCodeForTokens(code);
  const customerId = await fetchFirstAccessibleCustomer(tokens.accessToken);
  if (!customerId) throw new Error("No accessible Google Ads customer found — grant access to at least one account and retry");

  await setGoogleOAuthConnection(workspaceId, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresInSeconds: tokens.expiresIn,
    customerId,
  });

  return { workspaceId };
}

export interface GoogleAdsCredentials {
  accessToken: string;
  customerId: string;
  developerToken: string;
}

/**
 * Returns a valid (refreshed if needed) access token for the workspace's connected Google
 * Ads customer, or null if not connected via real OAuth or manual connect. Unlike Meta's
 * long-lived tokens, Google access tokens expire hourly, so every call here may
 * transparently refresh and persist a new one before returning — unless the integration
 * was manually connected without a refresh token, in which case refreshing is impossible
 * and the stored access token is returned as-is (it'll fail upstream once it expires).
 * The developer token prefers a per-workspace one from a manual connect, falling back to
 * the global GOOGLE_ADS_DEVELOPER_TOKEN env var used by the OAuth-connect path.
 */
export async function getGoogleAdsCredentials(workspaceId: string): Promise<GoogleAdsCredentials | null> {
  const raw = await getRawGoogleTokenData(workspaceId);
  if (!raw) return null;

  const developerToken = raw.developerToken ?? GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return null;

  if (!raw.refreshToken) {
    return { accessToken: raw.accessToken, customerId: raw.customerId, developerToken };
  }

  const expiresAt = new Date(raw.tokenExpiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return { accessToken: raw.accessToken, customerId: raw.customerId, developerToken };
  }

  const refreshed = await refreshAccessToken(raw.refreshToken, raw.clientId, raw.clientSecret);
  await updateGoogleAccessToken(workspaceId, refreshed.accessToken, refreshed.expiresIn);
  return { accessToken: refreshed.accessToken, customerId: raw.customerId, developerToken };
}
