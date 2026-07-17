import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { asyncHandler } from "./asyncHandler.js";
import { logger } from "../modules/logger/logger.js";
import { disconnectIntegration } from "../modules/integrations/integrationService.js";
import { prisma } from "../db/prisma.js";

const SHOPIFY_APP_CLIENT_SECRET = process.env.SHOPIFY_APP_CLIENT_SECRET;

export const shopifyWebhookRoutes = Router();

export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Shopify's webhook HMAC scheme — distinct from the OAuth-callback HMAC in shopifyOAuth.ts
 * (that one signs sorted query params, hex-encoded; this one signs the raw request body,
 * base64-encoded). Reuses the same req.rawBody stash express.json()'s `verify` callback
 * already populates in index.ts for the Meta webhook route — no new body-parsing
 * middleware needed.
 */
export function isValidShopifyWebhookSignature(req: RequestWithRawBody): boolean {
  if (!SHOPIFY_APP_CLIENT_SECRET) {
    logger.warn("SHOPIFY_APP_CLIENT_SECRET not set — rejecting Shopify webhook delivery (cannot verify signature)");
    return false;
  }
  const header = req.header("x-shopify-hmac-sha256");
  if (!header || !req.rawBody) return false;

  const expected = createHmac("sha256", SHOPIFY_APP_CLIENT_SECRET).update(req.rawBody).digest("base64");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function workspaceIdForShop(shopDomain: string): Promise<string | null> {
  const rows = await prisma.integration.findMany({ where: { platform: "shopify" } });
  const match = rows.find((r) => (r.data as any)?.accountId === shopDomain);
  return match?.workspaceId ?? null;
}

/** Merchant uninstalled the app from their Shopify admin — revoke the stored connection so
 * no further catalog syncs are attempted with what is now a dead token. */
shopifyWebhookRoutes.post(
  "/app-uninstalled",
  asyncHandler(async (req: RequestWithRawBody, res) => {
    if (!isValidShopifyWebhookSignature(req)) return res.sendStatus(401);

    const shopDomain = req.header("x-shopify-shop-domain");
    const workspaceId = shopDomain ? await workspaceIdForShop(shopDomain) : null;
    if (workspaceId) {
      await disconnectIntegration(workspaceId, "shopify");
      logger.info(`Shopify app uninstalled — disconnected integration for workspace ${workspaceId}`);
    } else {
      logger.warn(`Shopify app/uninstalled webhook for unknown shop domain: ${shopDomain}`);
    }
    res.sendStatus(200);
  })
);

/**
 * The 3 GDPR-mandatory webhooks every public Shopify app must implement for App Store
 * review — customers/data_request and customers/redact concern one specific customer's
 * data within a shop (this app stores no per-customer PII beyond what's already product
 * catalog data, so both are acknowledged with no action needed beyond the 200); shop/redact
 * fires 48 hours after a shop uninstalls, requesting full erasure of that shop's data.
 */
shopifyWebhookRoutes.post(
  "/customers-data-request",
  asyncHandler(async (req: RequestWithRawBody, res) => {
    if (!isValidShopifyWebhookSignature(req)) return res.sendStatus(401);
    logger.info("Shopify customers/data_request received — this app stores no per-customer PII beyond catalog data, nothing to export");
    res.sendStatus(200);
  })
);

shopifyWebhookRoutes.post(
  "/customers-redact",
  asyncHandler(async (req: RequestWithRawBody, res) => {
    if (!isValidShopifyWebhookSignature(req)) return res.sendStatus(401);
    logger.info("Shopify customers/redact received — this app stores no per-customer PII beyond catalog data, nothing to redact");
    res.sendStatus(200);
  })
);

shopifyWebhookRoutes.post(
  "/shop-redact",
  asyncHandler(async (req: RequestWithRawBody, res) => {
    if (!isValidShopifyWebhookSignature(req)) return res.sendStatus(401);
    const body = req.body as { shop_domain?: string };
    const workspaceId = body?.shop_domain ? await workspaceIdForShop(body.shop_domain) : null;
    if (workspaceId) {
      await disconnectIntegration(workspaceId, "shopify");
      logger.info(`Shopify shop/redact received — erased stored connection for workspace ${workspaceId}`);
    } else {
      logger.warn(`Shopify shop/redact webhook for unknown shop domain: ${body?.shop_domain}`);
    }
    res.sendStatus(200);
  })
);
