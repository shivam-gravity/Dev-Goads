import { logger } from "../modules/logger/logger.js";
import { crawl4aiCrawl, crawl4aiMap, crawl4aiScrape } from "./crawl4aiClient.js";
import type { CrawlPage, MapLink, ScrapeData, ScrapeFormat, ScrapeOutage } from "./scrapeTypes.js";
import { discoverSitemapPages, scrapeUrl, SCREENSHOT_TIMEOUT_MS } from "../modules/onboarding/scraper.js";

/**
 * Dual-source web content extraction: the Playwright-backed in-house scraper (scraper-service)
 * and the self-hosted crawl4ai service run CONCURRENTLY for every map/scrape/crawl, and their
 * results are merged. This replaces the previous "in-house first, Firecrawl only on failure"
 * fallback chain — both were rebuilt because (a) Firecrawl was removed in favor of self-hosted
 * crawl4ai (no per-call credit budget, so there's no cost reason to hold one back), and (b)
 * running them together means each covers the other's blind spots on the same request rather
 * than only after a detectable failure: crawl4ai's headless render handles JS-heavy pages the
 * in-house sitemap/HTTP path misses, while the in-house path handles product/JSON-LD shapes
 * and screenshots crawl4ai may not populate. `search` is deliberately NOT covered here — that
 * capability is SearXNG (searchRouter.ts).
 */

export type ScrapeSource = "inhouse" | "crawl4ai" | "merged" | "none";

// Kill switch — set SCRAPE_INHOUSE_ENABLED=false to skip the in-house attempt and use only
// crawl4ai (e.g. if the scraper-service is down), with no code change. crawl4ai can't be
// disabled the same way; if its URL is unset it simply returns a no-key outage and the merge
// falls back to whatever the in-house path produced.
const INHOUSE_ENABLED = process.env.SCRAPE_INHOUSE_ENABLED !== "false" && process.env.SCRAPE_FALLBACK_ENABLED !== "false";

// Both sources race under this same window in parallel, so the wall-clock cost of running both
// is the SLOWER of the two, not their sum. Env-tunable and raised from the old 15s: crawl4ai's
// FIRST crawl after idle is a cold start (it spins up a headless browser context) and on a
// JS-heavy SPA that legitimately takes ~15-16s — right at the old ceiling, so it aborted and the
// prefetch got zero content → zero facts → every provider fell back to (flaky) web search and the
// CORE providers timed out to 0. Warm, the same crawl returns in ~4s. 30s clears the cold start
// with margin; the in-house path (fast when it works) still returns early, so this only extends
// the wait when crawl4ai is the ONLY source that can render the page (exactly the SPA case).
const ATTEMPT_TIMEOUT_MS = Number(process.env.SCRAPE_ATTEMPT_TIMEOUT_MS ?? 30_000);

const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ?? "http://localhost:4003";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

// Signals a scrape landed on a bot-block/CAPTCHA page rather than real content — a real
// HTTP 200 with garbage content would otherwise be silently accepted as "success". With two
// sources running, this decides which one's content is trustworthy when both return something.
const BLOCK_PAGE_SIGNAL = /captcha|access denied|are you a robot|unusual traffic/i;
const MIN_USABLE_TEXT_LENGTH = 200;

function looksBlocked(statusCode: number | undefined, text: string | null | undefined): boolean {
  if (statusCode !== undefined && (statusCode < 200 || statusCode >= 300)) return true;
  if (!text || text.length >= MIN_USABLE_TEXT_LENGTH) return false;
  return BLOCK_PAGE_SIGNAL.test(text);
}

/** Races `promise` against a plain timer — for wrapping calls (discoverSitemapPages, scrapeUrl,
 * crawl4ai POSTs) so one slow source can't hold the whole parallel merge past the provider
 * ceiling. Soft timeout: stops WAITING, doesn't necessarily kill the underlying work. */
function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Attempt timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Runs a thunk under the attempt timeout, converting any throw/timeout into null so a failed
 * source never rejects the Promise.all — the merge just sees "this source produced nothing." */
async function settle<T>(label: string, thunk: () => Promise<T>): Promise<T | null> {
  try {
    return await raceWithTimeout(thunk(), ATTEMPT_TIMEOUT_MS);
  } catch (err) {
    logger.warn(`scrapeFallback: ${label} failed or timed out`, err);
    return null;
  }
}

interface ResearchScrapeResponse {
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  product?: ScrapeData["product"];
  metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
}

/** Direct fetch to scraper-service's /research/scrape — mirrors onboarding/scraper.ts's
 * captureScreenshot pattern (AbortController timeout, X-Internal-Service-Key header,
 * catch-and-return-null, never throws). */
async function fetchResearchScrape(url: string, wantProduct: boolean): Promise<ResearchScrapeResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
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
    logger.warn(`scrapeFallback: in-house scrape unreachable or failed for ${url}`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isUsableScrapeData(data: ScrapeData | null, formats: ScrapeFormat[]): boolean {
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

/* ─────────────────────────────  map  ───────────────────────────── */

export interface MapFallbackResult {
  links: MapLink[];
  outage: ScrapeOutage | null;
  source: ScrapeSource;
}

export async function mapUrlWithFallback(url: string, opts?: { limit?: number }): Promise<MapFallbackResult> {
  const limit = opts?.limit ?? 100;
  const [inhouse, crawl4ai] = await Promise.all([
    INHOUSE_ENABLED ? settle("in-house map", () => inHouseMap(url, limit)) : Promise.resolve(null),
    settle("crawl4ai map", () => crawl4aiMap(url, { limit }).then((r) => (r.outage ? null : r.links))),
  ]);

  // Merge both link sets, de-duplicated by pathname, capped at the limit.
  const seen = new Set<string>();
  const links: MapLink[] = [];
  for (const link of [...(inhouse ?? []), ...(crawl4ai ?? [])]) {
    let key: string;
    try { key = new URL(link.url).pathname; } catch { key = link.url; }
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
    if (links.length >= limit) break;
  }

  return { links, outage: null, source: mergedSource(!!inhouse?.length, !!crawl4ai?.length) };
}

async function inHouseMap(url: string, limit: number): Promise<MapLink[]> {
  const origin = new URL(url).origin;
  const sitemapPages = await discoverSitemapPages(origin);
  if (sitemapPages.length > 0) {
    return sitemapPages.slice(0, limit).map((page) => ({ url: page.url }));
  }

  // No sitemap — scrape the entry URL once and take its same-origin outbound links.
  const scraped = await fetchResearchScrape(url, false);
  if (!scraped?.links) return [];
  const seen = new Set<string>();
  const links: MapLink[] = [];
  for (const link of scraped.links) {
    try {
      const parsed = new URL(link);
      if (parsed.origin !== origin) continue;
      if (seen.has(parsed.pathname)) continue;
      seen.add(parsed.pathname);
      links.push({ url: link });
      if (links.length >= limit) break;
    } catch {
      // malformed href — skip
    }
  }
  return links;
}

/* ─────────────────────────────  scrape  ───────────────────────────── */

export interface ScrapeFallbackResult {
  data: ScrapeData | null;
  outage: ScrapeOutage | null;
  source: ScrapeSource;
}

export async function scrapeUrlWithFallback(url: string, formats: ScrapeFormat[]): Promise<ScrapeFallbackResult> {
  const wantProduct = formats.some((f) => typeof f === "object" && f.type === "product");

  const [inhouseData, crawl4aiData] = await Promise.all([
    INHOUSE_ENABLED
      ? settle("in-house scrape", async () => {
          const scraped = await fetchResearchScrape(url, wantProduct);
          if (!scraped) return null;
          const data: ScrapeData = {
            markdown: scraped.markdown,
            html: scraped.html,
            links: scraped.links,
            screenshot: scraped.screenshot,
            product: scraped.product,
            metadata: scraped.metadata,
          };
          return isUsableScrapeData(data, formats) ? data : null;
        })
      : Promise.resolve(null),
    settle("crawl4ai scrape", async () => {
      const { data, outage } = await crawl4aiScrape(url, formats);
      if (outage || !data) return null;
      return isUsableScrapeData(data, formats) ? data : null;
    }),
  ]);

  const merged = mergeScrapeData(inhouseData, crawl4aiData, wantProduct);
  if (!merged) return { data: null, outage: null, source: "none" };
  return { data: merged, outage: null, source: mergedSource(!!inhouseData, !!crawl4aiData) };
}

/**
 * Field-level merge of the two sources' scrape output. The in-house path is preferred for
 * product/JSON-LD structure and screenshots (its Playwright capture is purpose-built for
 * those); crawl4ai is preferred for markdown/html body text when its headless render produced
 * more than the in-house HTTP fetch. Each field falls back to whichever source has it, so a
 * gap in one is filled by the other rather than lost.
 */
function mergeScrapeData(inhouse: ScrapeData | null, crawl4ai: ScrapeData | null, preferInhouseProduct: boolean): ScrapeData | null {
  if (!inhouse && !crawl4ai) return null;
  if (!crawl4ai) return inhouse;
  if (!inhouse) return crawl4ai;

  const inhouseMd = inhouse.markdown ?? "";
  const crawlMd = crawl4ai.markdown ?? "";
  return {
    // richer body text wins
    markdown: crawlMd.length > inhouseMd.length ? crawl4ai.markdown : inhouse.markdown,
    html: inhouse.html ?? crawl4ai.html,
    links: [...new Set([...(inhouse.links ?? []), ...(crawl4ai.links ?? [])])],
    screenshot: inhouse.screenshot ?? crawl4ai.screenshot,
    json: inhouse.json ?? crawl4ai.json,
    product: preferInhouseProduct ? (inhouse.product ?? crawl4ai.product) : (crawl4ai.product ?? inhouse.product),
    metadata: { ...crawl4ai.metadata, ...inhouse.metadata },
  };
}

/* ─────────────────────────────  crawl (multi-page)  ───────────────────────────── */

export interface CrawlFallbackResult {
  pages: CrawlPage[];
  outage: ScrapeOutage | null;
  source: ScrapeSource;
  /** Site-level, populated when the in-house path ran (scrapeUrl captures one internally). */
  screenshot?: string;
  /** Site-level, populated when the in-house path ran — in-house crawl pages don't populate
   * per-page `links`, so callers use this instead of deriving images from pages[0].links. */
  images?: string[];
}

export async function crawlUrlWithFallback(url: string, opts: { limit?: number; formats?: ScrapeFormat[] }): Promise<CrawlFallbackResult> {
  const [inhouse, crawl4aiPages] = await Promise.all([
    INHOUSE_ENABLED
      ? settle("in-house crawl", async () => {
          // scrapeUrl awaits a trailing screenshot (up to SCREENSHOT_TIMEOUT_MS) before
          // returning, so give this branch that extra headroom over ATTEMPT_TIMEOUT_MS.
          const site = await raceWithTimeout(
            scrapeUrl(url, { crawlCap: opts.limit, timeBudgetMs: ATTEMPT_TIMEOUT_MS }),
            ATTEMPT_TIMEOUT_MS + SCREENSHOT_TIMEOUT_MS
          );
          if (!site.pages?.length || looksBlocked(undefined, site.excerpt)) return null;
          const pages: CrawlPage[] = site.pages.map((page) => ({
            markdown: page.cleanedText,
            html: page.html,
            metadata: { title: page.title, sourceURL: page.url },
          }));
          return { pages, screenshot: site.screenshot, images: site.images };
        })
      : Promise.resolve(null),
    settle("crawl4ai crawl", async () => {
      const { pages, outage } = await crawl4aiCrawl(url, opts);
      return outage ? null : pages;
    }),
  ]);

  // Merge pages from both sources, de-duplicated by source URL so the same page crawled by
  // both isn't double-counted (in-house content preferred where both have the same URL).
  const byUrl = new Map<string, CrawlPage>();
  for (const page of crawl4aiPages ?? []) {
    const key = page.metadata?.sourceURL ?? `crawl4ai-${byUrl.size}`;
    byUrl.set(key, page);
  }
  for (const page of inhouse?.pages ?? []) {
    const key = page.metadata?.sourceURL ?? `inhouse-${byUrl.size}`;
    byUrl.set(key, page); // in-house overwrites crawl4ai for the same URL
  }

  const pages = [...byUrl.values()];
  return {
    pages,
    outage: null,
    source: mergedSource(!!inhouse?.pages.length, !!crawl4aiPages?.length),
    screenshot: inhouse?.screenshot,
    images: inhouse?.images,
  };
}

/** Which source(s) actually produced content — drives sourceLabel and audit trail. */
function mergedSource(hasInhouse: boolean, hasCrawl4ai: boolean): ScrapeSource {
  if (hasInhouse && hasCrawl4ai) return "merged";
  if (hasInhouse) return "inhouse";
  if (hasCrawl4ai) return "crawl4ai";
  return "none";
}

/** Human-readable dataSource label, source-aware — lets the UI/audit trail distinguish which
 * backend(s) served a given result. */
export function sourceLabel(source: ScrapeSource, detail: string): string {
  switch (source) {
    case "inhouse": return `In-house scrape (${detail})`;
    case "crawl4ai": return `crawl4ai (${detail})`;
    case "merged": return `In-house + crawl4ai (${detail})`;
    case "none": return `No content retrieved (${detail})`;
  }
}
