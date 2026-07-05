import type { ProductCatalogAdapter } from "./ProductCatalogAdapter.js";
import { logger } from "../../logger/logger.js";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const hasLiveCredentials = Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_ADMIN_ACCESS_TOKEN);

export const shopifyCatalogAdapter: ProductCatalogAdapter = {
  hasLiveCredentials,

  async fetchCatalog() {
    logger.info(`Fetching Shopify product catalog for store: ${SHOPIFY_STORE_DOMAIN}`);

    try {
      const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products.json?limit=50`;
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN! },
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
        url: `https://${SHOPIFY_STORE_DOMAIN}/products/${p.handle}`,
      }));
    } catch (err) {
      logger.error("Failed to fetch Shopify product catalog", err);
      throw err;
    }
  },
};
