import { redisClient } from "./redisClient.js";
import { logger } from "../modules/logger/logger.js";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_MONTHLY_CREDIT_LIMIT = Number(process.env.FIRECRAWL_MONTHLY_CREDIT_LIMIT ?? 950);
const BASE_URL = "https://api.firecrawl.dev/v2";
const CRAWL_POLL_INTERVAL_MS = 2000;
const CRAWL_POLL_TIMEOUT_MS = 60_000;
const CREDIT_KEY_TTL_SECONDS = 60 * 60 * 24 * 40; // ~40 days — comfortably outlives the calendar month the key is keyed by

// /map and /scrape don't report their own credits-used back in the response body (confirmed
// against Firecrawl's own API docs) — these are conservative fixed estimates used only for the
// budget guard below; /search and /crawl DO report a real creditsUsed, which is used instead of
// guessing whenever it's present.
const ESTIMATED_CREDITS = { map: 1, scrape: 1, scrapeStructured: 2 } as const;

export const FIRECRAWL_NO_KEY_DATA_SOURCE = "Firecrawl not configured (FIRECRAWL_API_KEY not set)";
export const FIRECRAWL_QUOTA_EXCEEDED_DATA_SOURCE = "Firecrawl monthly credit budget reached — resumes next month";

/** Calendar-month bucket, e.g. "firecrawl:credits:2026-07" — a fresh, empty counter every month
 * without needing a cron to reset it. */
function creditBudgetKey(): string {
  const now = new Date();
  return `firecrawl:credits:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Whether this month's recorded Firecrawl usage is still under FIRECRAWL_MONTHLY_CREDIT_LIMIT.
 * A Redis read failure fails OPEN (allows the call) rather than closed — a transient Redis blip
 * shouldn't silently stop every Firecrawl-backed provider from ever running. */
async function withinBudget(): Promise<boolean> {
  try {
    const used = Number((await redisClient.get(creditBudgetKey())) ?? 0);
    return used < FIRECRAWL_MONTHLY_CREDIT_LIMIT;
  } catch (err) {
    logger.warn("firecrawlClient: failed to read credit budget from Redis — allowing the call", err);
    return true;
  }
}

async function recordCredits(amount: number): Promise<void> {
  if (!amount || amount <= 0) return;
  try {
    const key = creditBudgetKey();
    await redisClient.incrby(key, amount);
    await redisClient.expire(key, CREDIT_KEY_TTL_SECONDS);
  } catch (err) {
    logger.warn("firecrawlClient: failed to record credit usage in Redis", err);
  }
}

export type FirecrawlOutage = "no-key" | "over-budget";

/** Every wrapper below returns `{ outage }` instead of throwing when Firecrawl can't be called —
 * mirrors the existing "missing OPENAI_API_KEY -> labeled partial, never throw" contract every
 * other provider already follows (see research/providers/support.ts's webSearchThenStructure). */
async function checkAvailable(): Promise<FirecrawlOutage | null> {
  if (!FIRECRAWL_API_KEY) return "no-key";
  if (!(await withinBudget())) return "over-budget";
  return null;
}

export function outageDataSource(outage: FirecrawlOutage): string {
  return outage === "no-key" ? FIRECRAWL_NO_KEY_DATA_SOURCE : FIRECRAWL_QUOTA_EXCEEDED_DATA_SOURCE;
}

// Every other external fetch in this codebase (SEOProvider, AutocompleteProvider, AdLibraryProvider's
// Meta call, ...) sets an explicit request timeout via AbortController — this client had been the
// one exception, which let a single hung Firecrawl response stall a provider (and everything
// awaiting it) indefinitely instead of degrading like a missing API key does.
const REQUEST_TIMEOUT_MS = 20_000;

async function post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`firecrawlClient: POST ${path} responded with ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn(`firecrawlClient: POST ${path} failed`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}` }, signal: controller.signal });
    if (!res.ok) {
      logger.warn(`firecrawlClient: GET ${path} responded with ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn(`firecrawlClient: GET ${path} failed`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────────  /scrape  ───────────────────────────── */

export type FirecrawlScrapeFormat = "markdown" | "html" | "rawHtml" | "links" | "screenshot" | { type: "json"; schema: Record<string, unknown>; prompt?: string } | { type: "product" };

export interface FirecrawlScrapeData {
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

export async function firecrawlScrape(url: string, formats: FirecrawlScrapeFormat[]): Promise<{ data: FirecrawlScrapeData | null; outage: FirecrawlOutage | null }> {
  const outage = await checkAvailable();
  if (outage) return { data: null, outage };

  const isStructured = formats.some((f) => typeof f === "object");
  const result = await post<{ success: boolean; data: FirecrawlScrapeData }>("/scrape", { url, formats });
  if (!result?.success) return { data: null, outage: null };

  await recordCredits(isStructured ? ESTIMATED_CREDITS.scrapeStructured : ESTIMATED_CREDITS.scrape);
  return { data: result.data, outage: null };
}

/* ─────────────────────────────  /map  ───────────────────────────── */

export interface FirecrawlMapLink {
  url: string;
  title?: string;
  description?: string;
}

export async function firecrawlMap(url: string, opts?: { limit?: number }): Promise<{ links: FirecrawlMapLink[]; outage: FirecrawlOutage | null }> {
  const outage = await checkAvailable();
  if (outage) return { links: [], outage };

  const result = await post<{ success: boolean; links: FirecrawlMapLink[] }>("/map", { url, limit: opts?.limit ?? 100 });
  if (!result?.success) return { links: [], outage: null };

  await recordCredits(ESTIMATED_CREDITS.map);
  return { links: result.links ?? [], outage: null };
}

/* ─────────────────────────────  /search  ───────────────────────────── */

export interface FirecrawlSearchWebResult {
  title: string;
  description: string;
  url: string;
  markdown?: string;
}

export interface FirecrawlSearchNewsResult {
  title: string;
  snippet: string;
  url: string;
  date?: string;
  position?: number;
}

export async function firecrawlSearch(
  query: string,
  opts?: { limit?: number; sources?: ("web" | "news" | "images")[]; includeDomains?: string[] }
): Promise<{ web: FirecrawlSearchWebResult[]; news: FirecrawlSearchNewsResult[]; outage: FirecrawlOutage | null }> {
  const outage = await checkAvailable();
  if (outage) return { web: [], news: [], outage };

  const result = await post<{ success: boolean; data: { web?: FirecrawlSearchWebResult[]; news?: FirecrawlSearchNewsResult[] }; creditsUsed?: number }>("/search", {
    query,
    limit: opts?.limit ?? 10,
    sources: (opts?.sources ?? ["web"]).map((type) => ({ type })),
    ...(opts?.includeDomains ? { includeDomains: opts.includeDomains } : {}),
  });
  if (!result?.success) return { web: [], news: [], outage: null };

  await recordCredits(result.creditsUsed ?? ESTIMATED_CREDITS.scrape);
  return { web: result.data.web ?? [], news: result.data.news ?? [], outage: null };
}

/* ─────────────────────────────  /crawl (async job, polled)  ───────────────────────────── */

export interface FirecrawlCrawlPage {
  markdown?: string;
  html?: string | null;
  links?: string[];
  screenshot?: string | null;
  metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
}

export async function firecrawlCrawl(
  url: string,
  opts: { limit?: number; formats?: FirecrawlScrapeFormat[] }
): Promise<{ pages: FirecrawlCrawlPage[]; outage: FirecrawlOutage | null }> {
  const outage = await checkAvailable();
  if (outage) return { pages: [], outage };

  const started = await post<{ success: boolean; id: string }>("/crawl", {
    url,
    limit: opts.limit ?? 15,
    scrapeOptions: { formats: opts.formats ?? ["markdown", "links"] },
  });
  if (!started?.success || !started.id) return { pages: [], outage: null };

  const deadline = Date.now() + CRAWL_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await get<{ status: string; data: FirecrawlCrawlPage[]; creditsUsed?: number }>(`/crawl/${started.id}`);
    if (!status) break;
    if (status.status === "completed" || status.status === "failed") {
      await recordCredits(status.creditsUsed ?? 0);
      return { pages: status.data ?? [], outage: null };
    }
    await new Promise((resolve) => setTimeout(resolve, CRAWL_POLL_INTERVAL_MS));
  }
  logger.warn(`firecrawlClient: crawl ${started.id} for ${url} didn't finish within ${CRAWL_POLL_TIMEOUT_MS}ms`);
  return { pages: [], outage: null };
}
