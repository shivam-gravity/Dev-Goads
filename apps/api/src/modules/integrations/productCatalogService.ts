import { getOrCreateIntegrations } from "./integrationService.js";
import { shopifyCatalogAdapter } from "./catalogAdapters/shopifyCatalogAdapter.js";
import { wooCommerceCatalogAdapter } from "./catalogAdapters/wooCommerceCatalogAdapter.js";
import type { ProductCatalogAdapter } from "./catalogAdapters/ProductCatalogAdapter.js";
import { logger } from "../logger/logger.js";
import type { ProductCatalogItem, ProductCatalogSource } from "../../types/index.js";

// The product picker's "Facebook feeds" tab surfaces Meta's commerce catalog, so it maps to the
// existing "meta" integration rather than a separate one.
const SOURCE_TO_PLATFORM: Record<ProductCatalogSource, "shopify" | "meta" | "google" | "woocommerce"> = {
  shopify: "shopify",
  facebook: "meta",
  google: "google",
  woocommerce: "woocommerce",
};

// Only sources with a real e-commerce catalog API behind them get a live adapter;
// facebook/google stay demo-only until Phase 5's ad-network catalog APIs are built out.
const CATALOG_ADAPTERS: Partial<Record<ProductCatalogSource, ProductCatalogAdapter>> = {
  shopify: shopifyCatalogAdapter,
  woocommerce: wooCommerceCatalogAdapter,
};

const PLACEHOLDER_IMAGE = (seed: string) => `https://placehold.co/300x300/7033f5/ffffff?text=${encodeURIComponent(seed)}`;

const MOCK_CATALOGS: Record<ProductCatalogSource, Omit<ProductCatalogItem, "id" | "source">[]> = {
  shopify: [
    { name: "Aurora Wireless Earbuds", category: "Electronics", priceCents: 7999, imageUrl: PLACEHOLDER_IMAGE("Earbuds"), url: "https://store.example.com/products/aurora-earbuds" },
    { name: "Nimbus Weekender Bag", category: "Bags", priceCents: 12900, imageUrl: PLACEHOLDER_IMAGE("Weekender"), url: "https://store.example.com/products/nimbus-bag" },
    { name: "Solstice Stainless Bottle", category: "Home & Living", priceCents: 2400, imageUrl: PLACEHOLDER_IMAGE("Bottle"), url: "https://store.example.com/products/solstice-bottle" },
    { name: "Drift Comfort Sneakers", category: "Footwear", priceCents: 8900, imageUrl: PLACEHOLDER_IMAGE("Sneakers"), url: "https://store.example.com/products/drift-sneakers" },
    { name: "Halo Skincare Set", category: "Beauty", priceCents: 5400, imageUrl: PLACEHOLDER_IMAGE("Skincare"), url: "https://store.example.com/products/halo-skincare" },
  ],
  facebook: [
    { name: "Everyday Tote", category: "Bags", priceCents: 5900, imageUrl: PLACEHOLDER_IMAGE("Tote"), url: "https://facebook.com/commerce/tote" },
    { name: "Fitness Resistance Bands Set", category: "Fitness", priceCents: 1999, imageUrl: PLACEHOLDER_IMAGE("Bands"), url: "https://facebook.com/commerce/bands" },
    { name: "Minimal Desk Lamp", category: "Home & Living", priceCents: 3400, imageUrl: PLACEHOLDER_IMAGE("Lamp"), url: "https://facebook.com/commerce/lamp" },
    { name: "Organic Cotton Tee", category: "Apparel", priceCents: 2200, imageUrl: PLACEHOLDER_IMAGE("Tee"), url: "https://facebook.com/commerce/tee" },
  ],
  google: [
    { name: "Portable Espresso Maker", category: "Kitchen", priceCents: 6500, imageUrl: PLACEHOLDER_IMAGE("Espresso"), url: "https://merchant.example.com/products/espresso-maker" },
    { name: "Adjustable Laptop Stand", category: "Office", priceCents: 4200, imageUrl: PLACEHOLDER_IMAGE("Stand"), url: "https://merchant.example.com/products/laptop-stand" },
    { name: "Noise-Isolating Headphones", category: "Electronics", priceCents: 9900, imageUrl: PLACEHOLDER_IMAGE("Headphones"), url: "https://merchant.example.com/products/headphones" },
    { name: "Insulated Lunch Box", category: "Kitchen", priceCents: 1800, imageUrl: PLACEHOLDER_IMAGE("Lunchbox"), url: "https://merchant.example.com/products/lunch-box" },
  ],
  woocommerce: [
    { name: "Canvas Utility Apron", category: "Home & Living", priceCents: 3200, imageUrl: PLACEHOLDER_IMAGE("Apron"), url: "https://store.example.com/product/canvas-apron" },
    { name: "Ceramic Pour-Over Set", category: "Kitchen", priceCents: 4800, imageUrl: PLACEHOLDER_IMAGE("Pour-Over"), url: "https://store.example.com/product/pour-over-set" },
    { name: "Wool Throw Blanket", category: "Home & Living", priceCents: 6900, imageUrl: PLACEHOLDER_IMAGE("Blanket"), url: "https://store.example.com/product/wool-throw" },
  ],
};

export interface CatalogSourceResult {
  source: ProductCatalogSource;
  connected: boolean;
  accountName?: string;
  items: ProductCatalogItem[];
}

/**
 * Live-fetch eligibility is the OR of two independent things: a global env-var-configured
 * store (`adapter.hasLiveCredentials`, the pre-OAuth fallback every adapter still supports)
 * or a real per-workspace OAuth connection (`connected`, computed by the caller from this
 * workspace's own Integration row) — checking only the former would mean a workspace that
 * genuinely connected its own Shopify store via OAuth still silently got the demo catalog,
 * because the *global* env vars happen to be unset.
 */
async function fetchItems(workspaceId: string, source: ProductCatalogSource, connected: boolean): Promise<Omit<ProductCatalogItem, "id" | "source">[]> {
  const adapter = CATALOG_ADAPTERS[source];
  if (!adapter || (!adapter.hasLiveCredentials && !connected)) return MOCK_CATALOGS[source];

  try {
    return await adapter.fetchCatalog(workspaceId);
  } catch (err) {
    logger.error(`Falling back to mock catalog for ${source} after live fetch failed`, err);
    return MOCK_CATALOGS[source];
  }
}

async function catalogForSource(workspaceId: string, source: ProductCatalogSource): Promise<CatalogSourceResult> {
  const platform = SOURCE_TO_PLATFORM[source];
  const integrations = await getOrCreateIntegrations(workspaceId);
  const integration = integrations.find((i) => i.platform === platform);
  const connected = integration?.status === "connected";
  const items = connected ? await fetchItems(workspaceId, source, connected) : [];
  return {
    source,
    connected,
    accountName: integration?.accountName,
    items: items.map((item, i) => ({ ...item, id: `${source}-${i}`, source })),
  };
}

/** Product catalog for the campaign generator's picker — real integration state, live catalog data when connected with credentials, demo data otherwise. */
export async function getProductCatalog(workspaceId: string, source: ProductCatalogSource | "all"): Promise<CatalogSourceResult[]> {
  const sources: ProductCatalogSource[] = source === "all" ? ["shopify", "facebook", "google", "woocommerce"] : [source];
  return Promise.all(sources.map((s) => catalogForSource(workspaceId, s)));
}
