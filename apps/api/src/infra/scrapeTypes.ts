/**
 * Vendor-neutral shapes for scraped/crawled web content. These were formerly named
 * `Firecrawl*` and lived in firecrawlClient.ts; Firecrawl was removed and replaced by the
 * self-hosted crawl4ai service (crawl4aiClient.ts), so the contract is re-homed here under
 * neutral names. Every research provider (WebsiteProvider, ProductProvider, ...) and the
 * scrapeFallback layer consume these — they are deliberately independent of any one crawl
 * vendor so the backend can change again without touching consumers.
 */

export type ScrapeFormat =
  | "markdown"
  | "html"
  | "rawHtml"
  | "links"
  | "screenshot"
  | { type: "json"; schema: Record<string, unknown>; prompt?: string }
  | { type: "product" };

export interface ScrapeData {
  markdown?: string | null;
  html?: string | null;
  links?: string[] | null;
  screenshot?: string | null;
  json?: unknown;
  product?: {
    title?: string;
    brand?: string;
    category?: string;
    description?: string;
    variants?: { title?: string; price?: { amount?: number; currency?: string; formatted?: string }; availability?: { inStock?: boolean; text?: string } }[];
  } | null;
  metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
}

export interface MapLink {
  url: string;
  title?: string;
  description?: string;
}

export interface CrawlPage {
  markdown?: string;
  html?: string | null;
  links?: string[];
  screenshot?: string | null;
  metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
}

/**
 * Only reason a crawl call can't run. Unlike Firecrawl (metered — had an "over-budget"
 * outage), crawl4ai is self-hosted with no per-call quota, so the sole outage is "the service
 * URL isn't configured / the instance is unreachable" — reusing the "no-key" value every
 * caller already handles (label the result partial, never throw).
 */
export type ScrapeOutage = "no-key";

export const CRAWL_NOT_CONFIGURED_DATA_SOURCE = "crawl4ai not configured (CRAWL4AI_BASE_URL not set)";

/** Human-readable dataSource label for an outage — replaces firecrawlClient's
 * outageDataSource. Only one outage value exists now, but the function shape is kept so
 * callers don't change. */
export function outageDataSource(_outage: ScrapeOutage): string {
  return CRAWL_NOT_CONFIGURED_DATA_SOURCE;
}
