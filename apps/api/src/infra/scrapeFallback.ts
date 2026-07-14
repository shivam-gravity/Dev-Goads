import { logger } from "../modules/logger/logger.js";
import {
  firecrawlCrawl,
  firecrawlMap,
  firecrawlScrape,
  type FirecrawlCrawlPage,
  type FirecrawlMapLink,
  type FirecrawlOutage,
  type FirecrawlScrapeData,
  type FirecrawlScrapeFormat,
} from "./firecrawlClient.js";
import { discoverSitemapPages, scrapeUrl, SCREENSHOT_TIMEOUT_MS } from "../modules/onboarding/scraper.js";

/**
 * In-house-first fallback for Firecrawl's map/scrape/crawl capabilities — tries a
 * Playwright-backed (scraper-service) or sitemap-based path first, since a successful
 * in-house attempt costs zero Firecrawl credits (the actual constraint driving this: the
 * hosted free tier caps at 1,000 credits/month). Only falls through to the real Firecrawl
 * API when the in-house attempt fails, times out, or produces content that looks blocked —
 * Firecrawl (with Fire-engine) remains the safety net for pages the in-house path can't
 * handle. `search` is deliberately NOT covered here — see ReviewsProvider/SocialMediaProvider
 * for that capability's existing webSearchThenStructure-first fallback.
 */

export type ScrapeSource = "inhouse" | "firecrawl";

// Kill switch — set SCRAPE_FALLBACK_ENABLED=false to skip every in-house attempt below and
// call Firecrawl directly, restoring pre-fallback behavior with no code change if the
// in-house path proves unreliable in production.
const FALLBACK_ENABLED = process.env.SCRAPE_FALLBACK_ENABLED !== "false";

// A third of the research orchestrator's 45s per-provider ceiling (PROVIDER_TIMEOUT_MS in
// ResearchOrchestrator.ts) — leaves the remaining ~30s comfortably enough for a full
// Firecrawl round-trip within that same shared window (which today runs standalone in the
// full 45s), so a slow/stalled in-house attempt can never crowd out its own fallback.
const INHOUSE_ATTEMPT_TIMEOUT_MS = 15_000;

const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ?? "http://localhost:4003";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

// Signals a scrape landed on a bot-block/CAPTCHA page rather than real content — a real
// HTTP 200 with garbage content would otherwise be silently accepted as "success" instead
// of correctly falling through to Firecrawl. The whole in-house-first bet is that most
// research targets aren't heavily bot-protected; this check is what makes that bet
// self-correcting instead of a blind spot.
const BLOCK_PAGE_SIGNAL = /captcha|access denied|are you a robot|unusual traffic/i;
const MIN_USABLE_TEXT_LENGTH = 200;

function looksBlocked(statusCode: number | undefined, text: string | null | undefined): boolean {
  if (statusCode !== undefined && (statusCode < 200 || statusCode >= 300)) return true;
  if (!text || text.length >= MIN_USABLE_TEXT_LENGTH) return false;
  return BLOCK_PAGE_SIGNAL.test(text);
}

/** Races `promise` against a plain timer — for wrapping in-house calls (discoverSitemapPages,
 * scrapeUrl) that don't accept an AbortSignal of their own. This stops WAITING at `ms`, it
 * doesn't necessarily kill the underlying operation — an honest "soft timeout," which is
 * enough here: the only requirement is that a slow in-house attempt can't crowd out its own
 * Firecrawl fallback within the shared 45s provider ceiling. */
function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`In-house attempt timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

interface ResearchScrapeResponse {
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  product?: FirecrawlScrapeData["product"];
  metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
}

/** Direct fetch to scraper-service's /research/scrape — mirrors the existing
 * onboarding/scraper.ts captureScreenshot pattern (AbortController timeout,
 * X-Internal-Service-Key header, catch-and-return-null, never throws). */
async function fetchResearchScrape(url: string, wantProduct: boolean): Promise<ResearchScrapeResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INHOUSE_ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${SCRAPER_SERVICE_URL}/research/scrape`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(INTERNAL_SERVICE_KEY ? { "X-Internal-Service-Key": INTERNAL_SERVICE_KEY } : {}),
      },
      body: JSON.stringify({ url, wantProduct }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ResearchScrapeResponse;
  } catch (err) {
    logger.warn(`scrapeFallback: in-house scrape unreachable or failed for ${url} — will fall through to Firecrawl`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isUsableScrapeData(data: FirecrawlScrapeData | null, formats: FirecrawlScrapeFormat[]): boolean {
  if (!data) return false;
  if (looksBlocked(data.metadata?.statusCode, data.markdown)) return false;
  return formats.some((format) => {
    if (typeof format === "object") {
      if (format.type === "product") return !!data.product;
      if (format.type === "json") return data.json !== undefined && data.json !== null;
    }
    if (format === "markdown") return !!data.markdown;
    if (format === "html") return !!data.html;
    if (format === "links") return !!data.links && data.links.length > 0;
    if (format === "screenshot") return !!data.screenshot;
    return false;
  });
}

export interface MapFallbackResult {
  links: FirecrawlMapLink[];
  outage: FirecrawlOutage | null;
  source: ScrapeSource;
}

export async function mapUrlWithFallback(url: string, opts?: { limit?: number }): Promise<MapFallbackResult> {
  if (FALLBACK_ENABLED) {
    try {
      const links = await raceWithTimeout(inHouseMap(url, opts?.limit ?? 100), INHOUSE_ATTEMPT_TIMEOUT_MS);
      if (links.length > 0) return { links, outage: null, source: "inhouse" };
    } catch (err) {
      logger.warn(`scrapeFallback: in-house map failed for ${url} — falling through to Firecrawl`, err);
    }
  }

  const result = await firecrawlMap(url, opts);
  return { links: result.links, outage: result.outage, source: "firecrawl" };
}

async function inHouseMap(url: string, limit: number): Promise<FirecrawlMapLink[]> {
  const origin = new URL(url).origin;
  const sitemapPages = await discoverSitemapPages(origin);
  if (sitemapPages.length > 0) {
    return sitemapPages.slice(0, limit).map((page) => ({ url: page.url }));
  }

  // No sitemap — fall back to one scrape of the entry URL and take its outbound links,
  // filtered to same-origin (a "map" of the site, not every external link on the page).
  const scraped = await fetchResearchScrape(url, false);
  if (!scraped?.links) return [];
  const seen = new Set<string>();
  const links: FirecrawlMapLink[] = [];
  for (const link of scraped.links) {
    try {
      const parsed = new URL(link);
      if (parsed.origin !== origin) continue;
      const key = parsed.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ url: link });
      if (links.length >= limit) break;
    } catch {
      // malformed href — skip it
    }
  }
  return links;
}

export interface ScrapeFallbackResult {
  data: FirecrawlScrapeData | null;
  outage: FirecrawlOutage | null;
  source: ScrapeSource;
}

export async function scrapeUrlWithFallback(url: string, formats: FirecrawlScrapeFormat[]): Promise<ScrapeFallbackResult> {
  if (FALLBACK_ENABLED) {
    try {
      const wantProduct = formats.some((f) => typeof f === "object" && f.type === "product");
      const scraped = await raceWithTimeout(fetchResearchScrape(url, wantProduct), INHOUSE_ATTEMPT_TIMEOUT_MS);
      if (scraped) {
        const data: FirecrawlScrapeData = {
          markdown: scraped.markdown,
          html: scraped.html,
          links: scraped.links,
          screenshot: scraped.screenshot,
          product: scraped.product,
          metadata: scraped.metadata,
        };
        if (isUsableScrapeData(data, formats)) return { data, outage: null, source: "inhouse" };
      }
    } catch (err) {
      logger.warn(`scrapeFallback: in-house scrape failed for ${url} — falling through to Firecrawl`, err);
    }
  }

  const result = await firecrawlScrape(url, formats);
  return { data: result.data, outage: result.outage, source: "firecrawl" };
}

export interface CrawlFallbackResult {
  pages: FirecrawlCrawlPage[];
  outage: FirecrawlOutage | null;
  source: ScrapeSource;
  /** Site-level, only populated when source === "inhouse" (scrapeUrl already captures one
   * internally) — the firecrawl branch leaves this undefined so callers make their own
   * separate firecrawlScrape(url, ["screenshot"]) call, exactly as they do today. */
  screenshot?: string;
  /** Site-level, only populated when source === "inhouse" — in-house crawl pages don't
   * populate per-page `links`, so callers should use this instead of deriving images from
   * pages[0].links the way the firecrawl branch does. */
  images?: string[];
}

export async function crawlUrlWithFallback(url: string, opts: { limit?: number; formats?: FirecrawlScrapeFormat[] }): Promise<CrawlFallbackResult> {
  if (FALLBACK_ENABLED) {
    try {
      // scrapeUrl's crawl loop respects timeBudgetMs on its own, but it then awaits its
      // trailing screenshot capture (up to SCREENSHOT_TIMEOUT_MS) before returning — the
      // outer race needs that same headroom added on top, or a screenshot that's still
      // legitimately in flight gets the whole crawl result (pages, images, everything)
      // discarded a moment before it would have succeeded.
      const site = await raceWithTimeout(
        scrapeUrl(url, { crawlCap: opts.limit, timeBudgetMs: INHOUSE_ATTEMPT_TIMEOUT_MS }),
        INHOUSE_ATTEMPT_TIMEOUT_MS + SCREENSHOT_TIMEOUT_MS
      );
      if (site.pages && site.pages.length > 0 && !looksBlocked(undefined, site.excerpt)) {
        const pages: FirecrawlCrawlPage[] = site.pages.map((page) => ({
          markdown: page.cleanedText,
          html: page.html,
          metadata: { title: page.title, sourceURL: page.url },
        }));
        return { pages, outage: null, source: "inhouse", screenshot: site.screenshot, images: site.images };
      }
    } catch (err) {
      logger.warn(`scrapeFallback: in-house crawl failed for ${url} — falling through to Firecrawl`, err);
    }
  }

  const result = await firecrawlCrawl(url, opts);
  return { pages: result.pages, outage: result.outage, source: "firecrawl" };
}

/** Human-readable dataSource label, source-aware — replaces a provider's previously fixed
 * Firecrawl-only DATA_SOURCE constant so the UI/audit trail can distinguish which backend
 * actually served a given result. */
export function sourceLabel(source: ScrapeSource, detail: string): string {
  return source === "inhouse" ? `In-house scrape (${detail})` : `Firecrawl (${detail})`;
}
