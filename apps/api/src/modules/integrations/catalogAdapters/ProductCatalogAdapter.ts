import type { ProductCatalogItem } from "../../../types/index.js";

export interface ProductCatalogAdapter {
  readonly hasLiveCredentials: boolean;
  fetchCatalog(): Promise<Omit<ProductCatalogItem, "id" | "source">[]>;
}
