import { scrapeUrlWithFallback } from "../../infra/scrapeFallback.js";
import { logger } from "../../modules/logger/logger.js";
import { withTimeout } from "../providers/support.js";

/**
 * The Meta/Google ad-source clients, extracted from AdLibraryProvider.ts so both that
 * provider (queries by the business's OWN name, feeding ResearchContext.adLibrary) and
 * CompetitorAdDiscovery.ts (queries by a competitor's name, feeding CompetitorAd rows) call
 * the exact same fetch logic instead of drifting apart. `attempted` distinguishes "we
 * genuinely queried the source and got zero ads back" from "we couldn't query it at all"
 * (missing credentials, network failure, blocked) — a caller doing time-series tracking
 * (first/last-seen, active status) must never treat a failed attempt as "this advertiser
 * has zero ads now," since that would wrongly deactivate every previously-seen ad.
 */

const META_GRAPH_VERSION = "v19.0";
const META_FETCH_TIMEOUT_MS = 10_000;
export const MAX_ADS_PER_SOURCE = 10;

export interface RawAdEntry {
  platform: "meta" | "google";
  externalAdId: string;
  advertiserName: string;
  headline?: string;
  bodyText?: string;
  sourceUrl: string;
}

interface MetaAdArchiveEntry {
  id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_snapshot_url?: string;
}

/** Meta's official, free, ToS-compliant public ads_archive search — real running/inactive ads
 * for any advertiser. Needs META_AD_LIBRARY_ACCESS_TOKEN; missing token degrades to skipping
 * this source (not a hard failure), same pattern as every other optional-credential provider. */
export async function fetchMetaAdsForQuery(query: string): Promise<{ ads: RawAdEntry[]; attempted: boolean }> {
  const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  if (!token) return { ads: [], attempted: false };

  const params = new URLSearchParams({
    access_token: token,
    search_terms: query,
    ad_reached_countries: JSON.stringify(["US"]),
    ad_type: "ALL",
    fields: "id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url",
    limit: String(MAX_ADS_PER_SOURCE),
  });

  try {
    const res = await withTimeout(fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/ads_archive?${params}`), META_FETCH_TIMEOUT_MS, "Meta ads_archive");
    if (!res.ok) {
      logger.warn(`adSourceClients: Meta ads_archive responded with ${res.status}`);
      return { ads: [], attempted: false };
    }
    const json = (await res.json()) as { data?: MetaAdArchiveEntry[] };
    const ads: RawAdEntry[] = (json.data ?? []).map((entry, i) => ({
      platform: "meta" as const,
      externalAdId: entry.id ?? entry.ad_snapshot_url ?? `${query}-meta-${i}`,
      advertiserName: entry.page_name ?? "Unknown advertiser",
      headline: entry.ad_creative_link_titles?.[0],
      bodyText: entry.ad_creative_bodies?.[0],
      sourceUrl: entry.ad_snapshot_url ?? "https://www.facebook.com/ads/library/",
    }));
    return { ads, attempted: true };
  } catch (err) {
    logger.warn("adSourceClients: Meta ads_archive request failed", err);
    return { ads: [], attempted: false };
  }
}

/** Google has no official Ad Library API — this is a best-effort scrape of Google Ads
 * Transparency Center's public search UI (in-house Playwright first, Firecrawl fallback via
 * scrapeUrlWithFallback). Not officially sanctioned by Google's ToS regardless of which tool
 * fetches it, so this degrades to an empty, `attempted: false` result on any markup
 * change/block rather than throwing. */
export async function fetchGoogleTransparencyAdsForQuery(query: string): Promise<{ ads: RawAdEntry[]; attempted: boolean; source: "inhouse" | "firecrawl" | null }> {
  const url = `https://adstransparency.google.com/?query=${encodeURIComponent(query)}&region=anywhere`;
  const scraped = await scrapeUrlWithFallback(url, ["markdown", "links"]);
  if (scraped.outage || !scraped.data) return { ads: [], attempted: false, source: null };

  const links = scraped.data.links ?? [];
  const creativeLinks = links.filter((link) => /\/advertiser\/|\/creative\//i.test(link)).slice(0, MAX_ADS_PER_SOURCE);
  const ads: RawAdEntry[] = creativeLinks.map((link) => ({
    platform: "google" as const,
    externalAdId: link,
    advertiserName: query,
    sourceUrl: link,
  }));
  return { ads, attempted: true, source: scraped.source };
}
