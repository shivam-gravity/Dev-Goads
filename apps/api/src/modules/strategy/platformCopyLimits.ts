import type { AdCreative, AdNetwork } from "../../types/index.js";

/**
 * Real per-network ad-copy limits — replacing the single flat 40-char constant this
 * codebase previously applied to every network regardless of which one a creative actually
 * targets. Meta and TikTok enforce their limits as soft (platform-side truncation/ellipsis
 * in the ad preview, not a hard API rejection); Google's Responsive Search Ads limits ARE
 * hard API-enforced per-asset character caps. Truncating client-side either way means the
 * creative always previews/launches as intended rather than surprising the advertiser with
 * platform-side truncation later.
 */
export const PLATFORM_COPY_LIMITS: Record<AdNetwork, { headline: number; body: number }> = {
  meta: { headline: 40, body: 125 },
  // Google RSA technically allows up to 15 headline assets (≤30 chars each) and 4
  // description assets (≤90 chars each) — this codebase generates one headline/body pair
  // per creative today, so this is the per-asset limit applied to that single pair, not a
  // multi-asset RSA set.
  google: { headline: 30, body: 90 },
  tiktok: { headline: 100, body: 100 },
};

export function truncateForPlatform(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Returns a new AdCreative with headline/body truncated to `network`'s real limits —
 * never mutates the input, since the same creative object is often reused across multiple
 * networks (see campaignOrchestrator.buildCampaignFromStrategy's creative × network
 * cross-product) and each network needs its own independently-truncated copy. */
export function applyCopyLimitsForNetwork(creative: AdCreative, network: AdNetwork): AdCreative {
  const limits = PLATFORM_COPY_LIMITS[network];
  return {
    ...creative,
    headline: truncateForPlatform(creative.headline, limits.headline),
    body: truncateForPlatform(creative.body, limits.body),
  };
}
