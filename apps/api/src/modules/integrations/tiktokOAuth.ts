import { logger } from "../logger/logger.js";
import { getTikTokCredentials, setTikTokOAuthConnection } from "./integrationService.js";
import { signOAuthState, verifyOAuthState } from "./oauthState.js";

// TikTok's Business/Marketing API (business-api.tiktok.com) has its own proprietary
// authorization flow — distinct from TikTok Login Kit's standard OAuth2 endpoint
// (open.tiktokapis.com/v2/oauth/token) which is for consumer-facing "Login with TikTok",
// not ad-account access. This targets the Marketing API specifically, matching what
// tiktokAdapter.ts already calls (business-api.tiktok.com/open_api/v1.3/...). Endpoint
// shapes confirmed via TikTok's official tiktok-business-api-sdk repo and current developer
// docs as of this implementation (2026) — TikTok's API surface does change over time, so
// re-verify against https://business-api.tiktok.com/portal/docs before a real production
// rollout, the same way this codebase's LLM SDK integrations were verified against live
// docs rather than assumed from training data.
const TIKTOK_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const TIKTOK_AUTH_URL = "https://business-api.tiktok.com/portal/auth";

const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID;
const TIKTOK_APP_SECRET = process.env.TIKTOK_APP_SECRET;
const TIKTOK_OAUTH_REDIRECT_URI = process.env.TIKTOK_OAUTH_REDIRECT_URI ?? "http://localhost:4000/api/integrations/tiktok/oauth/callback";

export const hasLiveTikTokAppCredentials = Boolean(TIKTOK_APP_ID && TIKTOK_APP_SECRET);

/**
 * TikTok's Business API authorization URL has no `scope`/`response_type` params the way
 * Meta/Google's standard OAuth2 dialogs do — permissions are configured at the app level in
 * the TikTok for Business developer portal instead, not requested per-authorization-request.
 */
export function getTikTokAuthUrl(workspaceId: string): string {
  const state = signOAuthState(workspaceId);
  const params = new URLSearchParams({
    app_id: TIKTOK_APP_ID ?? "",
    redirect_uri: TIKTOK_OAUTH_REDIRECT_URI,
    state,
  });
  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

// Realistic-shaped mock connection, same "(mock)" labeling convention as
// metaOAuth.ts/googleOAuth.ts's mock connects — never silently indistinguishable from a real one.
async function mockConnectTikTok(workspaceId: string): Promise<void> {
  await setTikTokOAuthConnection(workspaceId, {
    accessToken: "mock-access-token",
    expiresInSeconds: 60 * 60 * 24,
    advertiserId: "7000000000000000001",
    advertiserName: "Polluxa TikTok Ads (mock)",
    mock: true,
  });
}

/**
 * Entry point for the "Connect" button. With no TikTok app registered there's nothing real
 * to redirect to, so this completes a mock connect immediately instead of round-tripping
 * through a dead authorization URL — same shape as startMetaConnect/startGoogleConnect.
 */
export async function startTikTokConnect(workspaceId: string): Promise<{ redirectUrl: string } | { mockConnected: true }> {
  if (!hasLiveTikTokAppCredentials) {
    logger.warn("TIKTOK_APP_ID/TIKTOK_APP_SECRET not set — mock-connecting TikTok instead of redirecting");
    await mockConnectTikTok(workspaceId);
    return { mockConnected: true };
  }
  return { redirectUrl: getTikTokAuthUrl(workspaceId) };
}

async function exchangeAuthCodeForToken(authCode: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(`${TIKTOK_BASE}/oauth2/access_token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: TIKTOK_APP_ID,
      secret: TIKTOK_APP_SECRET,
      auth_code: authCode,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as any;
  const data = json?.data ?? json;
  if (!res.ok || !data?.access_token) {
    throw new Error(`TikTok token exchange failed: ${json?.message ?? res.status}`);
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 60 * 60 * 24 };
}

async function fetchFirstAdvertiser(accessToken: string): Promise<{ id: string; name: string } | null> {
  const params = new URLSearchParams({ app_id: TIKTOK_APP_ID ?? "", secret: TIKTOK_APP_SECRET ?? "" });
  const res = await fetch(`${TIKTOK_BASE}/oauth2/advertiser/get/?${params.toString()}`, {
    headers: { "Access-Token": accessToken },
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Failed to list TikTok advertisers: ${json?.message ?? res.status}`);
  const first = (json?.data?.list ?? [])[0];
  return first ? { id: first.advertiser_id, name: first.advertiser_name ?? `Advertiser ${first.advertiser_id}` } : null;
}

/**
 * Completes the OAuth handshake: auth_code -> access token, then picks the first
 * advertiser account the user granted access to (multi-account picker is a follow-up, same
 * as Meta's ad-account selection). Falls back to mock connect when no TikTok app is
 * registered, so local dev keeps working without real credentials.
 */
export async function handleTikTokOAuthCallback(authCode: string, state: string): Promise<{ workspaceId: string }> {
  const { workspaceId } = verifyOAuthState(state);

  if (!hasLiveTikTokAppCredentials) {
    logger.warn("TIKTOK_APP_ID/TIKTOK_APP_SECRET not set — completing TikTok OAuth callback with mock connect");
    await mockConnectTikTok(workspaceId);
    return { workspaceId };
  }

  const token = await exchangeAuthCodeForToken(authCode);
  const advertiser = await fetchFirstAdvertiser(token.accessToken);
  if (!advertiser) throw new Error("No advertiser account found on this TikTok user — grant access to at least one advertiser and retry");

  await setTikTokOAuthConnection(workspaceId, {
    accessToken: token.accessToken,
    expiresInSeconds: token.expiresIn,
    advertiserId: advertiser.id,
    advertiserName: advertiser.name,
  });

  return { workspaceId };
}

// No mock advertiser list: without a real TikTok OAuth connection this is empty, so the connect
// UI prompts a real connection rather than offering a fabricated "(mock)" advertiser to select.
export async function listAdvertisers(workspaceId: string): Promise<{ id: string; name: string }[]> {
  const credentials = await getTikTokCredentials(workspaceId);
  if (!credentials) return [];
  const params = new URLSearchParams({ app_id: TIKTOK_APP_ID ?? "", secret: TIKTOK_APP_SECRET ?? "" });
  const res = await fetch(`${TIKTOK_BASE}/oauth2/advertiser/get/?${params.toString()}`, {
    headers: { "Access-Token": credentials.accessToken },
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Failed to list TikTok advertisers: ${json?.message ?? res.status}`);
  return ((json?.data?.list ?? []) as any[]).map((a) => ({ id: a.advertiser_id, name: a.advertiser_name ?? `Advertiser ${a.advertiser_id}` }));
}
