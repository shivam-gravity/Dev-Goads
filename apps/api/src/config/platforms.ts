import type { AdNetwork } from "../types/index.js";

/**
 * Single source of truth for which advertising platforms this product supports and,
 * of those, which it can actually launch on today. The frontend has its own mirror of
 * this list (apps/web/src/constants/platforms.ts) because web (Vite) and api (Node) are
 * separate workspaces with no shared package — keep the two in sync when a platform ships.
 */
export type PlatformStatus = "active" | "coming_soon";

export interface PlatformConfig {
  value: string;
  label: string;
  status: PlatformStatus;
}

/**
 * The networks we can build and launch campaigns on right now. This const tuple is the
 * backend source of truth: the /campaigns/generate Zod enum, strategyEngine's CORE_NETWORKS,
 * and the campaign builders' variant filtering all derive from it. Widen it (and add an
 * adapter) when a "coming_soon" network graduates.
 */
export const ACTIVE_NETWORKS = ["meta", "google"] as const;
export type ActiveNetwork = (typeof ACTIVE_NETWORKS)[number];

/**
 * Full platform catalog, including not-yet-launchable networks kept visible in the UI as
 * "Coming soon". Every entry with status "active" must appear in ACTIVE_NETWORKS above.
 */
export const SUPPORTED_PLATFORMS: PlatformConfig[] = [
  { value: "meta", label: "Meta", status: "active" },
  { value: "google", label: "Google", status: "active" },
  { value: "tiktok", label: "TikTok", status: "coming_soon" },
  { value: "linkedin", label: "LinkedIn", status: "coming_soon" },
];

/** Narrows an arbitrary network string to one we can actually launch on. Used by the campaign
 * builders to drop variants for networks that only exist as "Coming soon" placeholders. */
export function isActiveNetwork(value: string): value is ActiveNetwork {
  return (ACTIVE_NETWORKS as readonly string[]).includes(value);
}

/** ACTIVE_NETWORKS as a plain AdNetwork[] for callers (e.g. CORE_NETWORKS) that want a mutable list. */
export const ACTIVE_NETWORK_LIST: AdNetwork[] = [...ACTIVE_NETWORKS];

/**
 * E-commerce / product-catalog integrations (store connections + catalog feed imports). The MVP
 * is scoped to Meta + Google ad DELIVERY only — all catalog/store sync (Shopify, WooCommerce, and
 * the Meta Commerce / Google GMC catalog feeds, which are demo-only stubs with no live adapter) is
 * deferred to a future version and shown as "Coming soon". This is the backend source of truth the
 * catalog + Shopify-OAuth endpoints gate on; the frontend mirrors it in constants/platforms.ts.
 *
 * When a catalog source ships, move it into ACTIVE_CATALOG_SOURCES (and wire its adapter).
 */
export const ACTIVE_CATALOG_SOURCES: readonly string[] = [];

/** True once a catalog source is actually available. Everything is "coming soon" today, so this
 * is always false — kept as a function so re-enabling a source is a one-line ACTIVE_CATALOG_SOURCES
 * edit rather than a hunt through call sites. */
export function isCatalogSourceEnabled(source: string): boolean {
  return ACTIVE_CATALOG_SOURCES.includes(source);
}

/** User-facing message for any deferred store/catalog feature hit via the API. */
export const CATALOG_COMING_SOON_MESSAGE =
  "Store & product-catalog integrations are coming soon. This version supports Meta and Google ad delivery; add products via URL or manual entry.";
