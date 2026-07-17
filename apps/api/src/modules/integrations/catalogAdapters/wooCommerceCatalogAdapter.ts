import type { ProductCatalogAdapter } from "./ProductCatalogAdapter.js";
import { logger } from "../../logger/logger.js";

const WOOCOMMERCE_STORE_URL = process.env.WOOCOMMERCE_STORE_URL;
const WOOCOMMERCE_CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const WOOCOMMERCE_CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;
const hasLiveCredentials = Boolean(WOOCOMMERCE_STORE_URL && WOOCOMMERCE_CONSUMER_KEY && WOOCOMMERCE_CONSUMER_SECRET);

export const wooCommerceCatalogAdapter: ProductCatalogAdapter = {
  hasLiveCredentials,

  async fetchCatalog() {
    logger.info(`Fetching WooCommerce product catalog for store: ${WOOCOMMERCE_STORE_URL}`);

    try {
      const auth = Buffer.from(`${WOOCOMMERCE_CONSUMER_KEY}:${WOOCOMMERCE_CONSUMER_SECRET}`).toString("base64");
      const url = `${WOOCOMMERCE_STORE_URL!.replace(/\/$/, "")}/wp-json/wc/v3/products?per_page=50`;
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      });

      if (!res.ok) {
        throw new Error(`WooCommerce API returned ${res.status}: ${await res.text()}`);
      }

      const products = (await res.json()) as any[];

      return products.map((p) => ({
        name: p.name,
        category: p.categories?.[0]?.name ?? "Uncategorized",
        priceCents: Math.round(Number(p.price ?? 0) * 100),
        imageUrl: p.images?.[0]?.src ?? "",
        url: p.permalink,
      }));
    } catch (err) {
      logger.error("Failed to fetch WooCommerce product catalog", err);
      throw err;
    }
  },
};
