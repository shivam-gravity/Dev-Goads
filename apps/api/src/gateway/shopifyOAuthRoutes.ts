import { Router } from "express";
import { getShopifyInstallUrl, isValidCallbackHmac, handleShopifyOAuthCallback, hasLiveShopifyAppCredentials } from "../modules/integrations/shopifyOAuth.js";
import { signOAuthState, verifyOAuthState } from "../modules/integrations/oauthState.js";
import { logger } from "../modules/logger/logger.js";

/**
 * Unauthenticated by design, same reasoning as metaOAuthRoutes.ts/tiktokOAuthRoutes.ts —
 * Shopify's install/consent redirect is a plain browser navigation. Workspace identity
 * travels through the signed `state` param. Mounted before the requireAuth-gated `/api`
 * router in src/index.ts.
 */
const WEB_APP_URL = process.env.WEB_APP_URL ?? "http://localhost:5173";

export const shopifyOAuthRoutes = Router();

/** Entry point for "Connect your Shopify store" — unlike Meta/Google's single global app
 * dialog, Shopify's install flow is inherently per-merchant-store, so the merchant's own
 * `shop` domain must already be known before a redirect URL can even be built. No
 * mock-connect fallback (see shopifyOAuth.ts's own doc comment for why). */
shopifyOAuthRoutes.get("/install", (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const shop = typeof req.query.shop === "string" ? req.query.shop : undefined;
  if (!workspaceId || !shop) return res.status(400).json({ error: "workspaceId and shop query params are required" });
  if (!hasLiveShopifyAppCredentials) {
    return res.redirect(`${WEB_APP_URL}/profile/ad-platform-connection?error=shopify_not_configured`);
  }
  const state = signOAuthState(workspaceId);
  res.redirect(getShopifyInstallUrl(shop, state));
});

shopifyOAuthRoutes.get("/callback", async (req, res) => {
  const shop = typeof req.query.shop === "string" ? req.query.shop : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const query = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));

  if (!shop || !code || !state) {
    return res.redirect(`${WEB_APP_URL}/profile/ad-platform-connection?error=missing_shop_code_or_state`);
  }
  if (!isValidCallbackHmac(query)) {
    logger.error(`Shopify OAuth callback HMAC verification failed for shop ${shop}`);
    return res.redirect(`${WEB_APP_URL}/profile/ad-platform-connection?error=shopify_hmac_invalid`);
  }

  try {
    const { workspaceId } = verifyOAuthState(state);
    await handleShopifyOAuthCallback(workspaceId, shop, code);
    res.redirect(`${WEB_APP_URL}/profile/ad-platform-connection?connected=shopify`);
  } catch (err) {
    logger.error("Shopify OAuth callback failed", err);
    res.redirect(`${WEB_APP_URL}/profile/ad-platform-connection?error=shopify_oauth_failed`);
  }
});
