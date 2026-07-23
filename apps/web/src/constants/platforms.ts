/**
 * UI mirror of the backend platform catalog (apps/api/src/config/platforms.ts). Web (Vite) and
 * api (Node) are separate workspaces with no shared package, so this list is duplicated by
 * design — keep the two in sync when a platform graduates from "coming_soon" to "active".
 */
export type PlatformStatus = "active" | "coming_soon";

export interface PlatformConfig {
  value: string;
  label: string;
  status: PlatformStatus;
}

export const SUPPORTED_PLATFORMS: PlatformConfig[] = [
  { value: "meta", label: "Meta", status: "active" },
  { value: "google", label: "Google", status: "active" },
  { value: "tiktok", label: "TikTok", status: "coming_soon" },
  { value: "linkedin", label: "LinkedIn", status: "coming_soon" },
];

/** Values of the platforms we can actually launch on today — used to seed default selections. */
export const ACTIVE_PLATFORM_VALUES = SUPPORTED_PLATFORMS
  .filter((p) => p.status === "active")
  .map((p) => p.value);

/**
 * E-commerce / product-catalog sync sources (store + catalog-feed imports). Mirrors the backend
 * ACTIVE_CATALOG_SOURCES in apps/api/src/config/platforms.ts. The MVP is scoped to Meta + Google
 * ad DELIVERY only, so ALL store/catalog sync is deferred and shown as "Coming soon" — users add
 * products via URL or manual entry instead. Flip a source to "active" here (and in the backend
 * config) when it ships.
 */
export const CATALOG_SOURCE_STATUS: Record<string, PlatformStatus> = {
  shopify: "coming_soon",
  woocommerce: "coming_soon",
  facebook: "coming_soon", // Meta Commerce feeds (catalog import — distinct from Meta ad delivery)
  google: "coming_soon", // Google Merchant Center feeds (catalog import — distinct from Google ad delivery)
};

/** True once a catalog sync source is actually available to connect. All are deferred today. */
export function isCatalogSourceActive(source: string): boolean {
  return CATALOG_SOURCE_STATUS[source] === "active";
}

/** Badge/label copy for a deferred store/catalog source in the UI. */
export const CATALOG_COMING_SOON_LABEL = "Coming Soon";
