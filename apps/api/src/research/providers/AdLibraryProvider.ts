import { firecrawlScrape } from "../../infra/firecrawlClient.js";
import { logger } from "../../modules/logger/logger.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { AdLibraryData, AdLibraryEntry, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { hostnameOf, runProviderStep, withTimeout } from "./support.js";

const META_GRAPH_VERSION = "v19.0";
const META_FETCH_TIMEOUT_MS = 10_000;
const MAX_ADS_PER_SOURCE = 10;

interface MetaAdArchiveEntry {
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_snapshot_url?: string;
}

/** Meta's official, free, ToS-compliant public ads_archive search — real running/inactive ads
 * for any advertiser. Needs META_AD_LIBRARY_ACCESS_TOKEN; missing token degrades to skipping this
 * source (not a hard failure), same pattern as every other optional-credential provider. */
async function fetchMetaAds(query: string): Promise<AdLibraryEntry[]> {
  const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  if (!token) return [];

  const params = new URLSearchParams({
    access_token: token,
    search_terms: query,
    ad_reached_countries: JSON.stringify(["US"]),
    ad_type: "ALL",
    fields: "page_name,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url",
    limit: String(MAX_ADS_PER_SOURCE),
  });

  try {
    const res = await withTimeout(fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/ads_archive?${params}`), META_FETCH_TIMEOUT_MS, "Meta ads_archive");
    if (!res.ok) {
      logger.warn(`AdLibraryProvider: Meta ads_archive responded with ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { data?: MetaAdArchiveEntry[] };
    return (json.data ?? []).map((entry) => ({
      platform: "meta" as const,
      advertiserName: entry.page_name ?? "Unknown advertiser",
      headline: entry.ad_creative_link_titles?.[0],
      bodyText: entry.ad_creative_bodies?.[0],
      sourceUrl: entry.ad_snapshot_url ?? "https://www.facebook.com/ads/library/",
    }));
  } catch (err) {
    logger.warn("AdLibraryProvider: Meta ads_archive request failed", err);
    return [];
  }
}

/** Google has no official Ad Library API — this is a best-effort scrape of Google Ads
 * Transparency Center's public search UI via Firecrawl (handles the JS rendering that page
 * needs). Not officially sanctioned by Google's ToS regardless of which tool fetches it, so this
 * is wrapped to degrade to an empty result on any markup change or block, never a thrown error. */
async function fetchGoogleTransparencyAds(query: string): Promise<AdLibraryEntry[]> {
  const url = `https://adstransparency.google.com/?query=${encodeURIComponent(query)}&region=anywhere`;
  const scraped = await firecrawlScrape(url, ["markdown", "links"]);
  if (scraped.outage || !scraped.data) return [];

  const links = scraped.data.links ?? [];
  const creativeLinks = links.filter((link) => /\/advertiser\/|\/creative\//i.test(link)).slice(0, MAX_ADS_PER_SOURCE);
  return creativeLinks.map((link) => ({
    platform: "google" as const,
    advertiserName: query,
    sourceUrl: link,
  }));
}

export class AdLibraryProvider implements ResearchProvider<AdLibraryData> {
  readonly name = "ad-library";
  readonly priority = 213;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<AdLibraryData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = input.businessName ?? hostnameOf(input.url).replace(/^www\./i, "").split(".")[0];

      const [metaAds, googleAds] = await Promise.all([fetchMetaAds(query), fetchGoogleTransparencyAds(query)]);
      const ads = [...metaAds, ...googleAds];

      const sources: string[] = [];
      if (metaAds.length > 0) sources.push("Meta Ad Library API (official)");
      if (googleAds.length > 0) sources.push("Google Ads Transparency Center (Firecrawl scrape, best-effort)");
      if (!process.env.META_AD_LIBRARY_ACCESS_TOKEN) sources.push("Meta source skipped — META_AD_LIBRARY_ACCESS_TOKEN not set");

      const data: AdLibraryData = { ads, dataSource: sources.length > 0 ? sources.join("; ") : "No ad library data found for this business" };
      return { status: ads.length > 0 ? "success" : "partial", data };
    });
  }
}
