import * as cheerio from "cheerio";
import type { ScrapedSite } from "../../types/index.js";
import { logger } from "../logger/logger.js";

const MAX_EXCERPT_LENGTH = 6000;
const FETCH_TIMEOUT_MS = 8000;
const SCREENSHOT_TIMEOUT_MS = 12000; // Playwright cold-starting a browser is slower than a plain fetch
const MAX_IMAGES = 8;
const MAX_CRAWL_PAGES = 3; // the entry page + up to 2 same-site links worth following

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

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

interface FetchedPage {
  url: string;
  $: cheerio.CheerioAPI;
}

async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AdGoOnboardingBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Site responded with ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, nav, footer").remove();
    return { url, $ };
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

function extractFollowLinks($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const links = new Map<string, number>(); // url -> score, dedup by pathname

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

    const label = `${resolved.pathname} ${$(el).text()}`;
    if (!FOLLOW_HINTS.test(label)) return;

    const key = resolved.origin + resolved.pathname;
    links.set(key, (links.get(key) ?? 0) + 1);
  });

  return [...links.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CRAWL_PAGES - 1)
    .map(([url]) => url);
}

/**
 * Crawls a business's promotional page (and a couple of same-site pages linked from it —
 * e.g. product/about/shop) so the strategy engine has more than a single page to reason about.
 */
export async function scrapeUrl(input: string): Promise<ScrapedSite> {
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

  // Screenshot capture (a separate service round-trip) runs alongside the cheerio crawl
  // below rather than after it, since the two are independent and Playwright cold-start
  // is the slower of the two — no reason to pay for them sequentially.
  const screenshotPromise = captureScreenshot(url);

  const entry = await fetchPage(url);
  const entryText = extractText(entry.$);
  const images = extractImages(entry.$, url);
  const crawledPages = [url];

  const excerptParts = [entryText.title, entryText.description, ...entryText.headings, entryText.bodyText];

  const followLinks = extractFollowLinks(entry.$, url);
  for (const link of followLinks) {
    try {
      const page = await fetchPage(link);
      const text = extractText(page.$);
      excerptParts.push(...text.headings, text.bodyText);
      images.push(...extractImages(page.$, link));
      crawledPages.push(link);
    } catch {
      // A secondary page failing to load shouldn't sink the whole crawl.
    }
  }

  const title = entryText.title || parsed.hostname;
  const description = entryText.description;
  const excerpt = excerptParts.filter(Boolean).join("\n").slice(0, MAX_EXCERPT_LENGTH * MAX_CRAWL_PAGES);

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
    screenshot,
  };
}
