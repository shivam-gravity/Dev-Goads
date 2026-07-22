import { logger } from "../modules/logger/logger.js";
import type { ScrapeData, ScrapeFormat, MapLink, CrawlPage, ScrapeOutage } from "./scrapeTypes.js";

/**
 * Client for the self-hosted crawl4ai service (docker-compose.yml's `crawl4ai` service,
 * image `unclecode/crawl4ai`). Replaces the removed firecrawlClient.ts. Because crawl4ai is
 * self-hosted and reachable only on this platform's own network, there is no API key and no
 * per-call credit budget — "not configured" means `CRAWL4AI_BASE_URL` isn't set (no instance
 * deployed in this environment), which every caller already handles identically to the old
 * "no-key" outage: label the result partial, never throw.
 *
 * The public surface (crawl4aiScrape/crawl4aiMap/crawl4aiCrawl + neutral return shapes) mirrors
 * the old firecrawl wrappers 1:1 so scrapeFallback.ts and the direct-scrape providers
 * (ReviewsProvider/SocialMediaProvider) change only their import, not their call shape.
 */

// Read fresh on every call rather than frozen at module load — this module is a singleton
// across an entire `npm test` run, so a const captured at first import would be immune to a
// later test's env changes (same reasoning firecrawlClient.ts documented for its key getter).
function crawl4aiBaseUrl(): string | undefined {
  return process.env.CRAWL4AI_BASE_URL;
}

// Optional bearer token — crawl4ai can be started with CRAWL4AI_API_TOKEN to require auth.
// When unset (the common self-hosted-on-private-network case) no Authorization header is sent.
function crawl4aiToken(): string | undefined {
  return process.env.CRAWL4AI_API_TOKEN;
}

// Must exceed the crawler's own page_timeout (below) or the HTTP request aborts before crawl4ai
// finishes rendering — which produced the AbortError storm on networkidle waits. 40s > 25s page.
const REQUEST_TIMEOUT_MS = 40_000;

export const CRAWL4AI_NO_URL_DATA_SOURCE = "crawl4ai not configured (CRAWL4AI_BASE_URL not set)";

/**
 * Global concurrency cap on in-flight crawl4ai requests. crawl4ai renders each URL in a real
 * headless browser from a small pool (a handful of workers); the research pipeline fans out
 * dozens of providers, each of which may crawl several URLs, so WITHOUT a cap the client fired
 * 100+ simultaneous crawls, saturated the browser pool, and every request then timed out at
 * 30s — enrichment silently degraded to thin snippets exactly when it mattered. This semaphore
 * bounds concurrency so crawls queue in-process and each still completes fast, instead of all
 * of them stampeding the server and all failing. Tunable via CRAWL4AI_MAX_CONCURRENCY.
 */
const MAX_CONCURRENCY = Math.max(1, Number(process.env.CRAWL4AI_MAX_CONCURRENCY ?? 4));
let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) next();
}

function checkAvailable(): ScrapeOutage | null {
  return crawl4aiBaseUrl() ? null : "no-key";
}

interface Crawl4aiResult {
  url?: string;
  html?: string | null;
  cleaned_html?: string | null;
  // crawl4ai returns markdown either as a plain string or as an object with raw/fit variants,
  // depending on version — normalizeMarkdown() handles both.
  markdown?: string | { raw_markdown?: string; fit_markdown?: string } | null;
  links?: { internal?: { href?: string }[]; external?: { href?: string }[] } | null;
  media?: { images?: { src?: string }[] } | null;
  metadata?: { title?: string; description?: string } | null;
  screenshot?: string | null;
  success?: boolean;
  status_code?: number;
}

interface Crawl4aiResponse {
  results?: Crawl4aiResult[];
  success?: boolean;
}

function normalizeMarkdown(md: Crawl4aiResult["markdown"]): string | null {
  if (!md) return null;
  if (typeof md === "string") return md;
  return md.fit_markdown || md.raw_markdown || null;
}

function collectLinks(result: Crawl4aiResult): string[] {
  const internal = (result.links?.internal ?? []).map((l) => l.href).filter((h): h is string => !!h);
  const external = (result.links?.external ?? []).map((l) => l.href).filter((h): h is string => !!h);
  return [...internal, ...external];
}

// A crawl4ai crawl fails TRANSIENTLY under concurrent load — a 500 from a momentarily-saturated
// browser pool, or a 429/503 — and a moment later the same URL succeeds (confirmed live: the
// up-front polluxa.com/crm crawl 500'd mid-burst while other URLs crawled fine seconds apart).
// So retry these with a short backoff rather than giving up, which is what made the fact-first
// prefetch silently fall back to the expensive search path. A 4xx other than 429 is a real
// client error (bad URL/auth) and is NOT retried.
const CRAWL4AI_MAX_RETRIES = Math.max(0, Number(process.env.CRAWL4AI_MAX_RETRIES ?? 2));
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** POST to a crawl4ai endpoint, returning null (never throwing) on any failure/timeout — same
 * degrade-don't-crash contract every external client in this codebase follows. Gated by the
 * concurrency semaphore so a burst of callers queues in-process instead of stampeding the
 * server's small browser pool. Retries transient statuses with backoff. The slot is acquired
 * only after the base-URL check so an unconfigured no-op never consumes one. */
async function post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const base = crawl4aiBaseUrl();
  if (!base) return null;
  const token = crawl4aiToken();

  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= CRAWL4AI_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(new URL(path, base).toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.ok) return (await res.json()) as T;
        if (RETRYABLE_STATUS.has(res.status) && attempt < CRAWL4AI_MAX_RETRIES) {
          clearTimeout(timer);
          logger.warn(`crawl4aiClient: POST ${path} responded with ${res.status} (transient) — retrying (attempt ${attempt + 1}/${CRAWL4AI_MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        logger.warn(`crawl4aiClient: POST ${path} responded with ${res.status}`);
        return null;
      } catch (err) {
        if (attempt < CRAWL4AI_MAX_RETRIES) {
          clearTimeout(timer);
          logger.warn(`crawl4aiClient: POST ${path} failed (transient) — retrying (attempt ${attempt + 1}/${CRAWL4AI_MAX_RETRIES})`, err);
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        logger.warn(`crawl4aiClient: POST ${path} failed or instance unreachable`, err);
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  } finally {
    releaseSlot();
  }
}

/** Build the crawler_config crawl4ai expects, translating our neutral format list into the
 * flags that turn on screenshotting / structured extraction. */
function crawlerConfig(formats: ScrapeFormat[], extra?: Record<string, unknown>): Record<string, unknown> {
  const wantScreenshot = formats.includes("screenshot");
  const jsonFormat = formats.find((f) => typeof f === "object" && f.type === "json") as
    | { type: "json"; schema: Record<string, unknown>; prompt?: string }
    | undefined;
  return {
    // Wait for client-side rendering before capturing HTML. Many marketing sites are SPAs
    // (Next.js/React) that ship a near-empty shell and hydrate content in JS — without waiting,
    // crawl4ai returns the shell, the page reads as "thin", no facts are extracted, and research
    // falls to the slow/low-confidence search path (e.g. polluxa.com root scored 62% and stalled,
    // while the content-rich /crm path scored 75%). networkidle + a short settle delay lets the
    // app hydrate so we get the real text. Cheap for static pages (they're already idle).
    wait_until: "networkidle",
    delay_before_return_html: 1.5,
    page_timeout: 25000, // must stay UNDER REQUEST_TIMEOUT_MS (40s) so crawl4ai returns before the HTTP request aborts
    ...(wantScreenshot ? { screenshot: true } : {}),
    ...(jsonFormat ? { extraction_strategy: { type: "json_css", schema: jsonFormat.schema } } : {}),
    ...extra,
  };
}

function toScrapeData(result: Crawl4aiResult): ScrapeData {
  return {
    markdown: normalizeMarkdown(result.markdown),
    html: result.html ?? result.cleaned_html ?? null,
    links: collectLinks(result),
    screenshot: result.screenshot ?? null,
    metadata: {
      title: result.metadata?.title,
      description: result.metadata?.description,
      sourceURL: result.url,
      statusCode: result.status_code,
    },
  };
}

/* ─────────────────────────────  scrape (single URL)  ───────────────────────────── */

export async function crawl4aiScrape(url: string, formats: ScrapeFormat[]): Promise<{ data: ScrapeData | null; outage: ScrapeOutage | null }> {
  const outage = checkAvailable();
  if (outage) return { data: null, outage };

  const result = await post<Crawl4aiResponse>("/crawl", {
    urls: [url],
    crawler_config: crawlerConfig(formats),
  });
  const first = result?.results?.[0];
  if (!first?.success) return { data: null, outage: null };

  const data = toScrapeData(first);
  // "product" extraction has no direct crawl4ai analogue to Firecrawl's managed product format;
  // downstream ProductProvider derives product shape from JSON-LD in the scraper-service path.
  // Structured JSON, when requested, is surfaced via crawl4ai's extraction_strategy output.
  const jsonFormat = formats.find((f) => typeof f === "object" && f.type === "json");
  if (jsonFormat && (first as unknown as { extracted_content?: unknown }).extracted_content) {
    data.json = (first as unknown as { extracted_content?: unknown }).extracted_content;
  }
  return { data, outage: null };
}

/* ─────────────────────────────  map (link discovery)  ───────────────────────────── */

export async function crawl4aiMap(url: string, opts?: { limit?: number }): Promise<{ links: MapLink[]; outage: ScrapeOutage | null }> {
  const outage = checkAvailable();
  if (outage) return { links: [], outage };

  // crawl4ai has no dedicated "map" endpoint; a single crawl of the entry URL yields its
  // discovered internal/external links, which is exactly what Firecrawl's /map returned.
  const result = await post<Crawl4aiResponse>("/crawl", { urls: [url], crawler_config: crawlerConfig(["links"]) });
  const first = result?.results?.[0];
  if (!first?.success) return { links: [], outage: null };

  const limit = opts?.limit ?? 100;
  const seen = new Set<string>();
  const links: MapLink[] = [];
  for (const href of collectLinks(first)) {
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ url: href });
    if (links.length >= limit) break;
  }
  return { links, outage: null };
}

/* ─────────────────────────────  crawl (multi-page)  ───────────────────────────── */

export async function crawl4aiCrawl(url: string, opts: { limit?: number; formats?: ScrapeFormat[] }): Promise<{ pages: CrawlPage[]; outage: ScrapeOutage | null }> {
  const outage = checkAvailable();
  if (outage) return { pages: [], outage };

  // deep_crawl_strategy tells crawl4ai to follow internal links up to `max_pages` — this is
  // crawl4ai's equivalent of Firecrawl's async /crawl job, but returns synchronously in one
  // response rather than needing a polled job id.
  const result = await post<Crawl4aiResponse>("/crawl", {
    urls: [url],
    crawler_config: crawlerConfig(opts.formats ?? ["markdown", "links"], {
      deep_crawl_strategy: { type: "bfs", max_pages: opts.limit ?? 15 },
    }),
  });
  if (!result?.results || result.results.length === 0) return { pages: [], outage: null };

  const pages: CrawlPage[] = result.results
    .filter((r) => r.success !== false)
    .map((r) => ({
      markdown: normalizeMarkdown(r.markdown) ?? undefined,
      html: r.html ?? null,
      links: collectLinks(r),
      screenshot: r.screenshot ?? null,
      metadata: { title: r.metadata?.title, sourceURL: r.url, statusCode: r.status_code },
    }));
  return { pages, outage: null };
}

export function isCrawl4aiConfigured(): boolean {
  return !!crawl4aiBaseUrl();
}
