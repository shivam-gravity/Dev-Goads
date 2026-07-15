import * as cheerio from "cheerio";
import type { ScrapedPage, ScrapedSite } from "../../types/index.js";
import { logger } from "../logger/logger.js";
import { ALLOW_ALL, isPathAllowed, parseRobots, type RobotsRules } from "./robots.js";

const MAX_EXCERPT_LENGTH = 6000;
const FETCH_TIMEOUT_MS = 8000;
// Playwright cold-starting a browser is slower than a plain fetch — 12s clipped real sites
// short (stripe.com measured ~15s end-to-end for a full render+screenshot), silently
// dropping the screenshot since captureScreenshot is best-effort. Exported so
// scrapeFallback.ts's crawl race can give scrapeUrl's trailing screenshot await the same
// headroom instead of timing out the whole crawl a moment before this settles.
export const SCREENSHOT_TIMEOUT_MS = 20000;
const MAX_IMAGES = 8;
const SMART_CRAWL_CAP = 15; // the entry page + up to 14 same-site pages worth following
const DISCOVERY_CAP = 200; // ceiling on how many URLs we bother scoring, not how many we fetch
const CRAWL_TIME_BUDGET_MS = 45_000; // wall-clock budget across the whole multi-page crawl loop
const MAX_SITEMAP_CHILDREN = 3; // sitemap index files can point at dozens of child sitemaps; only follow the first few

const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ?? "http://localhost:4003";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

/**
 * Real above-the-fold screenshot via the Playwright-backed scraper-service (already used
 * for product-catalog import) — reused here rather than adding a second headless-browser
 * dependency to apps/api. Best-effort: returns undefined (never throws) if that service is
 * unreachable, times out, or fails to render the page, so a screenshot outage never sinks
 * the rest of the onboarding crawl.
 */
async function captureScreenshot(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);
  try {
    const res = await fetch(`${SCRAPER_SERVICE_URL}/products/scrape`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(INTERNAL_SERVICE_KEY ? { "X-Internal-Service-Key": INTERNAL_SERVICE_KEY } : {}),
      },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { screenshot?: string };
    return json.screenshot;
  } catch (err) {
    logger.warn(`captureScreenshot: scraper-service unreachable or failed for ${url} — continuing without a screenshot`, err);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

// Link text/paths that tend to carry the richest product/brand context beyond the homepage.
const FOLLOW_HINTS = /\b(product|products|shop|store|about|features|pricing|collections?)\b/i;

// Politeness floor between fetches to the same origin — raised (up to robots.ts's cap)
// when the site's robots.txt sets a Crawl-delay. Shared across concurrent crawls in this
// process via lastFetchByOrigin, so two simultaneous crawls of the same site don't each
// think they're being polite while together hammering it at 2x.
const MIN_FETCH_INTERVAL_MS = 300;
const lastFetchByOrigin = new Map<string, number>();

async function politeDelay(origin: string, crawlDelayMs: number | null): Promise<void> {
  const interval = Math.max(MIN_FETCH_INTERVAL_MS, crawlDelayMs ?? 0);
  const last = lastFetchByOrigin.get(origin) ?? 0;
  const waitMs = last + interval - Date.now();
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  lastFetchByOrigin.set(origin, Date.now());
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

interface FetchedPage {
  url: string;
  $: cheerio.CheerioAPI;
  /** Raw HTML as fetched, before cheerio strips script/style/nav/footer — kept so callers
   * can persist it to object storage for reprocessing, independent of the cleaned excerpt. */
  html: string;
}

async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PolluxaOnboardingBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Site responded with ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, nav, footer").remove();
    return { url, $, html };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Timed out fetching that URL — check it's reachable and try again");
    }
    throw new Error(err instanceof Error ? `Couldn't fetch that URL: ${err.message}` : "Couldn't fetch that URL");
  } finally {
    clearTimeout(timeout);
  }
}

function extractText($: cheerio.CheerioAPI) {
  const title = $("title").first().text().trim();
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";
  const headings = $("h1, h2, h3")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  return { title, description, headings, bodyText };
}

function extractImages($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const resolve = (src?: string | null) => {
    if (!src) return null;
    try {
      return new URL(src, base).toString();
    } catch {
      return null;
    }
  };

  const found: string[] = [];
  const og = resolve($('meta[property="og:image"]').attr("content"));
  if (og) found.push(og);

  $("img").each((_, el) => {
    if (found.length >= MAX_IMAGES) return;
    const src = resolve($(el).attr("src") || $(el).attr("data-src"));
    if (src && !/\.(svg)(\?|$)/i.test(src)) found.push(src);
  });

  return [...new Set(found)].slice(0, MAX_IMAGES);
}

/** Same-origin links found in a page's own HTML, deduped by pathname — used both as the
 * BFS-fallback discovery set (when there's no sitemap) and as one scoring input alongside
 * sitemap priority. Unlike the old extractFollowLinks, this does NOT filter by FOLLOW_HINTS —
 * that filtering now happens once, centrally, in scoreAndSelect. */
function extractSameOriginLinks($: cheerio.CheerioAPI, pageUrl: string): Map<string, string> {
  const base = new URL(pageUrl);
  const links = new Map<string, string>(); // pathname key -> full url, dedup by pathname

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      return;
    }
    if (resolved.origin !== base.origin) return;
    if (resolved.pathname === base.pathname || resolved.pathname === "/") return;

    const key = resolved.origin + resolved.pathname;
    if (!links.has(key)) links.set(key, resolved.toString());
  });

  return links;
}

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; PolluxaOnboardingBot/1.0)" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DiscoveredPage {
  url: string;
  /** Higher = more likely to be worth crawling. Sitemap <priority> (0-1) when available, else a hint-based guess. */
  score: number;
}

function extractSitemapEntries($: cheerio.CheerioAPI): DiscoveredPage[] {
  const entries: DiscoveredPage[] = [];
  $("url").each((_, el) => {
    const loc = $(el).find("loc").first().text().trim();
    if (!loc) return;
    const priority = parseFloat($(el).find("priority").first().text().trim());
    entries.push({ url: loc, score: Number.isFinite(priority) ? priority : 0.5 });
  });
  return entries;
}

/**
 * Tries sitemap.xml (then robots.txt's `Sitemap:` directive as a fallback location) to get an
 * authoritative page list for the site — this is what lets pagesDiscovered reflect the site's
 * real size instead of just "links visible on the homepage." Returns [] (never throws) if no
 * sitemap exists or it fails to parse, so the caller falls back to homepage-link discovery.
 */
export async function discoverSitemapPages(origin: string): Promise<DiscoveredPage[]> {
  let xml = await fetchText(`${origin}/sitemap.xml`);
  if (!xml) {
    const robots = await fetchText(`${origin}/robots.txt`);
    const match = robots?.match(/^Sitemap:\s*(\S+)/im);
    if (match) xml = await fetchText(match[1]);
  }
  if (!xml) return [];

  const $ = cheerio.load(xml, { xmlMode: true });

  // Sitemap index files point at child sitemaps rather than listing pages directly — follow
  // a handful of them and merge, rather than trying to fetch every child (some sites shard
  // sitemaps by the thousands).
  const childSitemapUrls = $("sitemapindex > sitemap > loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .slice(0, MAX_SITEMAP_CHILDREN);

  if (childSitemapUrls.length > 0) {
    const merged: DiscoveredPage[] = [];
    for (const childUrl of childSitemapUrls) {
      const childXml = await fetchText(childUrl);
      if (!childXml) continue;
      merged.push(...extractSitemapEntries(cheerio.load(childXml, { xmlMode: true })));
      if (merged.length >= DISCOVERY_CAP) break;
    }
    return merged.slice(0, DISCOVERY_CAP);
  }

  return extractSitemapEntries($).slice(0, DISCOVERY_CAP);
}

/**
 * Builds the discovered-page set (sitemap first, homepage links as fallback) and picks the
 * top SMART_CRAWL_CAP - 1 to actually crawl alongside the entry page. Scoring blends sitemap
 * priority (when present) with the existing FOLLOW_HINTS path/text heuristic, so a page that's
 * both high-priority in the sitemap AND looks like a product/about/pricing page sorts first.
 */
export async function discoverAndSelectPages(entryUrl: string, entry$: cheerio.CheerioAPI): Promise<{ toCrawl: DiscoveredPage[]; totalDiscovered: number }> {
  const base = new URL(entryUrl);
  const homepageLinks = extractSameOriginLinks(entry$, entryUrl);

  const sitemapPages = await discoverSitemapPages(base.origin);
  const bySitemap = sitemapPages.length > 0;

  const candidates = new Map<string, number>(); // full url -> score
  if (bySitemap) {
    for (const { url, score } of sitemapPages) {
      try {
        const u = new URL(url);
        if (u.origin !== base.origin || u.pathname === base.pathname || u.pathname === "/") continue;
        candidates.set(u.toString(), score);
      } catch {
        // malformed sitemap entry — skip it
      }
    }
  } else {
    for (const url of homepageLinks.values()) candidates.set(url, 0.5);
  }

  const totalDiscovered = candidates.size;

  const scored = [...candidates.entries()].map(([url, baseScore]) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { url, score: -1 };
    }
    const hintBonus = FOLLOW_HINTS.test(u.pathname) ? 1 : 0;
    return { url, score: baseScore + hintBonus };
  });

  const toCrawl = scored.sort((a, b) => b.score - a.score).slice(0, SMART_CRAWL_CAP - 1);

  return { toCrawl, totalDiscovered };
}

// Site-wide chrome (nav taglines, cookie notices, newsletter CTAs, copyright lines, sticky
// CTAs) shows up verbatim on nearly every page of a site — unlike genuine page content.
// cheerio's blunt `nav, footer` removal in fetchPage doesn't catch chrome implemented as
// plain body elements (cookie banners, promo bars), so this catches what that misses.
// Cross-page repetition, not a fixed keyword stoplist, is the signal: it self-calibrates to
// whatever boilerplate THIS site actually uses instead of needing every variant enumerated,
// and it directly cuts what factExtraction.ts pays tokens to read (a sentence repeated on
// all 15 crawled pages otherwise costs ~15x its real information value).
const BOILERPLATE_MIN_PAGES = 3; // fewer pages gives no reliable "site chrome vs. real repetition" signal
const BOILERPLATE_FREQUENCY_RATIO = 0.5; // appears on at least half the crawled pages -> template, not content

function splitIntoChunks(text: string): string[] {
  // bodyText already has newlines collapsed to spaces (extractText), so sentence-terminator
  // boundaries are the only structure left to split on — crude, but enough to isolate a
  // repeated boilerplate sentence from the page-unique ones around it.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strips chunks that recur across most of this crawl's pages, keyed by exact chunk text.
 * A page whose entire body turned out to be 100% site-wide chrome keeps its original text
 * rather than going blank — over-including once beats silently losing a page's only
 * content to an overzealous filter. */
function stripCrossPageBoilerplate(bodyTextByUrl: Map<string, string>): Map<string, string> {
  if (bodyTextByUrl.size < BOILERPLATE_MIN_PAGES) return bodyTextByUrl;

  const chunksByUrl = new Map<string, string[]>();
  const pageCountByChunk = new Map<string, number>();
  for (const [url, text] of bodyTextByUrl) {
    const chunks = splitIntoChunks(text);
    chunksByUrl.set(url, chunks);
    for (const c of new Set(chunks)) pageCountByChunk.set(c, (pageCountByChunk.get(c) ?? 0) + 1);
  }

  const threshold = Math.ceil(bodyTextByUrl.size * BOILERPLATE_FREQUENCY_RATIO);
  const result = new Map<string, string>();
  for (const [url, chunks] of chunksByUrl) {
    const kept = chunks.filter((c) => (pageCountByChunk.get(c) ?? 0) < threshold);
    result.set(url, kept.length > 0 ? kept.join(" ") : bodyTextByUrl.get(url)!);
  }
  return result;
}

/** Best-effort page classification from the URL path — used for CrawlPage.pageType so
 * crawled pages can be queried/filtered by kind (e.g. "show me every pricing page we've seen")
 * without re-parsing content. */
function derivePageType(pageUrl: string, isEntry: boolean): string {
  if (isEntry) return "homepage";
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return "other";
  }
  if (/\bpricing\b/i.test(pathname)) return "pricing";
  if (/\babout\b/i.test(pathname)) return "about";
  if (/\bfeatures?\b/i.test(pathname)) return "features";
  if (/\b(product|products|shop|store|collections?)\b/i.test(pathname)) return "product";
  return "other";
}

/**
 * Crawls a business's promotional site — the entry page plus up to SMART_CRAWL_CAP-1 more
 * same-site pages, chosen via sitemap.xml (falling back to the homepage's own links when no
 * sitemap exists) — so the strategy engine has a representative slice of the whole site to
 * reason about, not just the homepage. Bounded by both SMART_CRAWL_CAP and
 * CRAWL_TIME_BUDGET_MS so a large site can't turn onboarding into a multi-minute wait; whatever
 * pages were fetched before the budget ran out are still used.
 */
export async function scrapeUrl(input: string, opts?: { crawlCap?: number; timeBudgetMs?: number }): Promise<ScrapedSite> {
  const url = normalizeUrl(input);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid website URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are supported");
  }

  // Defaults match onboarding's own tuning exactly (zero behavior change for its 7
  // existing callers) — callers outside onboarding (e.g. the research/campaign-generation
  // crawl-fallback in apps/api/src/infra/scrapeFallback.ts) pass their own values instead
  // of silently inheriting onboarding's, since the two features' latency/quality tradeoffs
  // are independently tuned, not coupled just because they happen to share this function.
  const crawlCap = opts?.crawlCap ?? SMART_CRAWL_CAP;
  const timeBudgetMs = opts?.timeBudgetMs ?? CRAWL_TIME_BUDGET_MS;

  // Screenshot capture (a separate service round-trip) runs alongside the cheerio crawl
  // below rather than after it, since the two are independent and Playwright cold-start
  // is the slower of the two — no reason to pay for them sequentially.
  const screenshotPromise = captureScreenshot(url);
  const crawlDeadline = Date.now() + timeBudgetMs;

  // robots.txt is honored for every page BEYOND the entry URL (the user explicitly asked
  // for the entry page, so that one is always fetched) — fetched alongside the entry page
  // since the two are independent. No robots.txt, or one that fails to parse -> allow all.
  const robotsPromise: Promise<RobotsRules> = fetchText(`${parsed.origin}/robots.txt`)
    .then((txt) => (txt ? parseRobots(txt) : ALLOW_ALL))
    .catch(() => ALLOW_ALL);

  await politeDelay(parsed.origin, null);
  const entry = await fetchPage(url);
  const robots = await robotsPromise;
  const entryText = extractText(entry.$);
  const images = extractImages(entry.$, url);
  const crawledPages = [url];

  interface RawPage {
    url: string;
    title: string;
    pageType: string;
    relevanceScore: number;
    html: string;
    description: string;
    headings: string[];
    bodyText: string;
  }

  const rawPages: RawPage[] = [
    {
      url,
      title: entryText.title || parsed.hostname,
      pageType: derivePageType(url, true),
      relevanceScore: 1,
      html: entry.html,
      description: entryText.description,
      headings: entryText.headings,
      bodyText: entryText.bodyText,
    },
  ];

  const { toCrawl, totalDiscovered } = await discoverAndSelectPages(url, entry.$);
  // discoverAndSelectPages already caps at its own module-level SMART_CRAWL_CAP - 1; when
  // an override crawlCap is smaller, re-slice down to it here rather than threading the
  // override through discoverAndSelectPages itself (unexported callers of that function
  // elsewhere keep today's fixed cap unchanged).
  const crawlable = toCrawl.slice(0, crawlCap - 1).filter(({ url: link }) => {
    try {
      const allowed = isPathAllowed(robots, new URL(link).pathname);
      if (!allowed) logger.info(`scrapeUrl: skipping ${link} — disallowed by robots.txt`);
      return allowed;
    } catch {
      return false;
    }
  });
  for (const { url: link, score } of crawlable) {
    if (Date.now() >= crawlDeadline) break;
    try {
      await politeDelay(parsed.origin, robots.crawlDelayMs);
      const page = await fetchPage(link);
      const text = extractText(page.$);
      images.push(...extractImages(page.$, link));
      crawledPages.push(link);
      rawPages.push({
        url: link,
        title: text.title || link,
        pageType: derivePageType(link, false),
        relevanceScore: score,
        html: page.html,
        description: text.description,
        headings: text.headings,
        bodyText: text.bodyText,
      });
    } catch {
      // A secondary page failing to load shouldn't sink the whole crawl.
    }
  }

  // Deferred until every page is fetched (not built inline per-page above) since the
  // cross-page boilerplate signal only exists once every page's body text is available to
  // compare against — this is pure in-memory post-processing over already-fetched text, so
  // it doesn't extend the crawl's own time budget.
  const filteredBodyByUrl = stripCrossPageBoilerplate(new Map(rawPages.map((p) => [p.url, p.bodyText])));

  const pages: ScrapedPage[] = rawPages.map((p) => ({
    url: p.url,
    title: p.title,
    pageType: p.pageType,
    relevanceScore: p.relevanceScore,
    cleanedText: [p.title, p.description, ...p.headings, filteredBodyByUrl.get(p.url) ?? p.bodyText]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_EXCERPT_LENGTH),
    html: p.html,
  }));

  const title = entryText.title || parsed.hostname;
  const description = entryText.description;
  const excerpt = pages
    .map((p) => p.cleanedText)
    .join("\n")
    .slice(0, MAX_EXCERPT_LENGTH * crawlCap);

  if (!excerpt) {
    throw new Error("Couldn't extract any readable text from that page");
  }

  const screenshot = await screenshotPromise;

  return {
    url,
    title,
    description,
    excerpt,
    images: [...new Set(images)].slice(0, MAX_IMAGES),
    crawledPages,
    pagesDiscovered: Math.max(totalDiscovered + 1, crawledPages.length), // +1 for the entry page itself, which discovery doesn't count
    screenshot,
    pages,
  };
}
