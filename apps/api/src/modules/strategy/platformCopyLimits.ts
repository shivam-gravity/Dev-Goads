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
  // Google Responsive Search Ads: ≤30 chars per headline asset, ≤90 chars per description asset.
  // These per-asset limits apply to EACH entry of the multi-asset RSA set the pipeline now
  // generates (see applyGoogleRsaLimits + AdCreative.headlines/descriptions).
  google: { headline: 30, body: 90 },
  tiktok: { headline: 100, body: 100 },
};

/**
 * Google Responsive Search Ad asset limits. Google requires a MINIMUM of 3 headlines and 2
 * descriptions or it rejects the ad; the pipeline targets the MAX we generate (5 headlines,
 * 4 descriptions) but never lets the published set fall below the minimum.
 */
export const GOOGLE_RSA_LIMITS = {
  headlineMaxChars: 30,
  descriptionMaxChars: 90,
  minHeadlines: 3,
  maxHeadlines: 15, // Google's hard ceiling — the pipeline targets 5, but never exceed this.
  minDescriptions: 2,
  maxDescriptions: 4, // Google's hard ceiling.
} as const;

export function truncateForPlatform(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Returns a new AdCreative with headline/body truncated to `network`'s real limits —
 * never mutates the input, since the same creative object is often reused across multiple
 * networks (see campaignOrchestrator.buildCampaignFromStrategy's creative × network
 * cross-product) and each network needs its own independently-truncated copy.
 *
 * For Google, this ALSO validates the multi-asset RSA arrays (headlines/descriptions) via
 * applyGoogleRsaLimits, so a Google variant carries a fully limit-checked RSA asset set. */
export function applyCopyLimitsForNetwork(creative: AdCreative, network: AdNetwork): AdCreative {
  const limits = PLATFORM_COPY_LIMITS[network];
  const base: AdCreative = {
    ...creative,
    headline: truncateForPlatform(creative.headline, limits.headline),
    body: truncateForPlatform(creative.body, limits.body),
  };
  return network === "google" ? applyGoogleRsaLimits(base) : base;
}

/**
 * Builds the validated Responsive Search Ad asset set for a creative: every headline truncated
 * to ≤30 chars and every description to ≤90 chars, de-duplicated, and capped at Google's per-ad
 * maxima (15 headlines / 4 descriptions — the pipeline targets 5 / 4). Sources from the
 * creative's `headlines`/`descriptions` pools, falling back to the singular headline/body so a
 * creative built without a CreativeAgent result still yields a valid (if minimal) set.
 *
 * Returns a NEW creative with normalized `headlines`/`descriptions` arrays; the singular
 * `headline`/`body` stay as the (already-truncated) first entry for back-compat. Note: this does
 * NOT invent assets to reach Google's 3-headline/2-description MINIMUM — that synthesis lives in
 * the adapter (buildResponsiveSearchAdAssets), which is the last line before the API call.
 */
export function applyGoogleRsaLimits(creative: AdCreative): AdCreative {
  const dedupeTruncate = (values: string[], maxChars: number, cap: number): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const text = truncateForPlatform(raw, maxChars);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= cap) break;
    }
    return out;
  };

  const headlineSource = creative.headlines?.length ? creative.headlines : [creative.headline];
  const descriptionSource = creative.descriptions?.length ? creative.descriptions : [creative.body];

  return {
    ...creative,
    headlines: dedupeTruncate(headlineSource, GOOGLE_RSA_LIMITS.headlineMaxChars, GOOGLE_RSA_LIMITS.maxHeadlines),
    descriptions: dedupeTruncate(descriptionSource, GOOGLE_RSA_LIMITS.descriptionMaxChars, GOOGLE_RSA_LIMITS.maxDescriptions),
  };
}
