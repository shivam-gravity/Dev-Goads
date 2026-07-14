import type { ProductCatalogItem } from "../../../types/index.js";

export interface ProductCatalogAdapter {
  /** Global env-var-configured credentials exist — the pre-per-workspace-OAuth fallback
   * path every adapter still supports. `hasLiveCredentials || a per-workspace connection` is
   * what actually decides whether fetchCatalog should be attempted over the mock catalog;
   * see productCatalogService.ts's fetchItems. */
  readonly hasLiveCredentials: boolean;
  /** `workspaceId` is optional and adapter-specific: shopifyCatalogAdapter uses it to look
   * up a per-merchant OAuth-connected store (falling back to the global env-var store when
   * absent or unconnected); wooCommerceCatalogAdapter ignores it today (no per-workspace
   * OAuth exists for WooCommerce yet) and always uses its global env vars. */
  fetchCatalog(workspaceId?: string): Promise<Omit<ProductCatalogItem, "id" | "source">[]>;
}
