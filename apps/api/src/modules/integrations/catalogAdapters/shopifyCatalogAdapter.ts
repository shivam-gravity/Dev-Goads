import type { ProductCatalogAdapter } from "./ProductCatalogAdapter.js";
import { getShopifyCredentials } from "../shopifyOAuth.js";
import { logger } from "../../logger/logger.js";

// Bumped from 2024-01 (the version this adapter shipped with originally) while this file
// was already being touched for per-workspace OAuth support.
const SHOPIFY_API_VERSION = "2025-01";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const hasLiveCredentials = Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_ADMIN_ACCESS_TOKEN);

async function fetchFrom(shopDomain: string, accessToken: string) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=50`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": accessToken },
  });

  if (!res.ok) {
    throw new Error(`Shopify API returned ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as any;
  const products = json?.products ?? [];

  return products.map((p: any) => ({
    name: p.title,
    category: p.product_type || "Uncategorized",
    priceCents: Math.round(Number(p.variants?.[0]?.price ?? 0) * 100),
    imageUrl: p.image?.src ?? "",
    url: `https://${shopDomain}/products/${p.handle}`,
  }));
}

export const shopifyCatalogAdapter: ProductCatalogAdapter = {
  hasLiveCredentials,

  /** Prefers a per-workspace OAuth-connected store (real merchant install, see
   * shopifyOAuth.ts) when `workspaceId` is given and that workspace has one; falls back to
   * the single global env-var-configured store otherwise — same fallback shape every other
   * adapter in this codebase already uses (Meta/Google/TikTok all prefer per-workspace
   * credentials over their own global env-var fallback). */
  async fetchCatalog(workspaceId?: string) {
    if (workspaceId) {
      const credentials = await getShopifyCredentials(workspaceId);
      if (credentials) {
        logger.info(`Fetching Shopify product catalog for store: ${credentials.shopDomain}`);
        return fetchFrom(credentials.shopDomain, credentials.accessToken);
      }
    }

    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error("No per-workspace Shopify connection and no global SHOPIFY_STORE_DOMAIN/SHOPIFY_ADMIN_ACCESS_TOKEN configured");
    }
    logger.info(`Fetching Shopify product catalog for store: ${SHOPIFY_STORE_DOMAIN}`);
    try {
      return await fetchFrom(SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN);
    } catch (err) {
      logger.error("Failed to fetch Shopify product catalog", err);
      throw err;
    }
  },
};
