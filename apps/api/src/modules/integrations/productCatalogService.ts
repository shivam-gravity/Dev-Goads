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
  // No real catalog adapter/credentials (e.g. facebook/google, which have no live adapter yet) →
  // return NO products rather than a fabricated demo catalog ("Aurora Wireless Earbuds"). The
  // picker shows an empty/"connect a store" state for that source instead of fake items.
  if (!adapter || (!adapter.hasLiveCredentials && !connected)) return [];

  try {
    return await adapter.fetchCatalog(workspaceId);
  } catch (err) {
    logger.error(`Live catalog fetch failed for ${source} — returning no products (no mock fallback)`, err);
    return [];
  }
}

async function catalogForSource(workspaceId: string, source: ProductCatalogSource): Promise<CatalogSourceResult> {
  // NOTE: the "coming soon" MVP guardrail lives at the user-facing boundaries — the Shopify OAuth
  // routes (can't link a new store) and the /products picker endpoint (router.ts returns 501 for
  // an explicit source). It is deliberately NOT enforced here: this shared read is also used by
  // internal analytics (AudienceIntelligenceEngine's LTV proxy), which should still read a catalog
  // that is already connected. In practice nothing can connect a store while the OAuth route is
  // gated, so this returns empty for real workspaces anyway.
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
