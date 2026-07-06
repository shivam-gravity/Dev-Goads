import { withPage } from "../scraping/browser.js";
import type { ScrapedImageCandidate, ScrapedProduct } from "../types.js";

const NAV_TIMEOUT_MS = 20_000;
const MAX_CANDIDATE_IMAGES = 20;
const MAX_BODY_TEXT_LENGTH = 8000;
const MAX_HTML_LENGTH = 50_000;
const MAX_DOM_SNAPSHOT_LENGTH = 20_000;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

// page.evaluate() scripts are passed as plain-string source rather than TS
// function literals. Under tsx (esbuild), a typed function literal gets
// wrapped with an esbuild `__name(...)` helper for stack-trace friendliness —
// that wrapper call ends up inside the function's serialized source and
// throws "__name is not defined" once it runs in the isolated page context,
// where no such helper exists. Plain strings bypass the transform entirely.
const EXTRACT_METADATA_SCRIPT = `(() => {
  const getMeta = (name) => document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]')?.getAttribute('content') ?? undefined;

  const jsonLd = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const parsed = JSON.parse(el.textContent ?? '');
      jsonLd.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Malformed JSON-LD on the page shouldn't sink the whole scrape.
    }
  });

  return {
    title: document.title,
    description: getMeta('description') ?? getMeta('og:description'),
    siteName: getMeta('og:site_name'),
    price: getMeta('product:price:amount') ?? getMeta('og:price:amount'),
    currency: getMeta('product:price:currency') ?? getMeta('og:price:currency'),
    jsonLd,
  };
})()`;

const EXTRACT_IMAGES_SCRIPT = `(() => {
  const max = ${MAX_CANDIDATE_IMAGES};
  const resolve = (src) => {
    if (!src) return null;
    try { return new URL(src, document.baseURI).toString(); } catch { return null; }
  };

  const found = [];
  const seen = new Set();
  const push = (url, source) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    found.push({ url, source });
  };

  // Nearly every site wraps its actual logo <img> in a link to the homepage —
  // a far more reliable signal than the image's own name/alt (many sites
  // don't bother labelling it) or bare header/nav position (which also holds
  // promo banners and mega-menu thumbnails on many sites).
  const isHomeLinked = (img) => {
    const a = img.closest('a');
    if (!a) return false;
    try {
      const href = new URL(a.getAttribute('href') || '', document.baseURI);
      return href.pathname === '/' && href.origin === location.origin;
    } catch {
      return false;
    }
  };
  const hasLogoName = (img) => {
    const hay = ((img.getAttribute('alt') || '') + ' ' + (img.getAttribute('src') || '') + ' ' + (img.className || '')).toLowerCase();
    return hay.indexOf('logo') !== -1;
  };
  const inHeaderish = (img) =>
    !!(img.closest('header') || img.closest('nav') || img.closest('[class*="header"]') || img.closest('[class*="navbar"]'));

  push(resolve(document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null), 'og');

  // Runs before the generic <img> sweep below, which can hit the overall cap
  // on image-heavy pages before ever reaching this — a targeted, small set
  // that shouldn't be crowded out. Many sites render their logo as an inline
  // <svg> for crisp scaling rather than an <img src>, which that sweep
  // structurally can't see (there's no URL to point at); serialize it as a
  // data URI so it fits the same string-URL shape as every other candidate.
  document.querySelectorAll('a').forEach((a) => {
    let href;
    try {
      href = new URL(a.getAttribute('href') || '', document.baseURI);
    } catch {
      return;
    }
    if (href.pathname !== '/' || href.origin !== location.origin) return;
    const svg = a.querySelector('svg');
    if (!svg) return;
    try {
      const encoded = btoa(unescape(encodeURIComponent(svg.outerHTML)));
      push('data:image/svg+xml;base64,' + encoded, 'logo-home');
    } catch {
      // Malformed/oversized SVG markup shouldn't sink the whole scrape.
    }
  });

  document.querySelectorAll('img').forEach((img) => {
    if (found.length >= max) return;
    const src = resolve(img.getAttribute('src') ?? img.getAttribute('data-src'));
    if (!src || /\\.svg(\\?|$)/i.test(src)) return;
    const source = isHomeLinked(img) ? 'logo-home' : hasLogoName(img) ? 'logo-name' : inHeaderish(img) ? 'logo-position' : 'img';
    push(src, source);
  });

  return found.slice(0, max);
})()`;

const EXTRACT_BODY_TEXT_SCRIPT = `document.body.innerText.replace(/\\s+/g, ' ').trim()`;

interface PageMetadata {
  title: string;
  description?: string;
  siteName?: string;
  price?: string;
  currency?: string;
  jsonLd: unknown[];
}

/**
 * Loads a product page in a real (headless) browser rather than fetch+cheerio
 * (see apps/api/src/modules/onboarding/scraper.ts) because product pages are
 * frequently client-rendered — price, images, and variant data often don't
 * exist in the raw HTML until JS runs. Returns raw material only; validating
 * images (Image Worker) and interpreting price/name/etc (Product Parser) are
 * separate stages.
 */
export async function scrapeProductUrl(input: string): Promise<ScrapedProduct> {
  const url = normalizeUrl(input);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid product URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are supported");
  }

  return withPage(async (page) => {
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (err) {
      throw new Error(err instanceof Error ? `Couldn't load that URL: ${err.message}` : "Couldn't load that URL");
    }

    // Best-effort settle for client-rendered content (product price/images
    // often populate after DOMContentLoaded). Not awaited as a hard
    // requirement — many real sites (analytics beacons, chat widgets) keep a
    // connection open indefinitely and would never reach true network idle.
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    const metadata = await page.evaluate<PageMetadata>(EXTRACT_METADATA_SCRIPT);
    const images = await page.evaluate<ScrapedImageCandidate[]>(EXTRACT_IMAGES_SCRIPT);
    const bodyText = await page.evaluate<string>(EXTRACT_BODY_TEXT_SCRIPT);

    // Above-the-fold capture (not fullPage) — mirrors what a human reviewer
    // sees first, and keeps the payload bounded on very long product pages.
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 60 });
    const screenshot = `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;

    // Accessibility-tree snapshot — a semantic, post-render view of the DOM
    // (roles/names/structure) that's far smaller and less noisy than raw HTML
    // for anything that needs to reason about page structure rather than markup.
    const domSnapshot = (await page.locator("body").ariaSnapshot()).slice(0, MAX_DOM_SNAPSHOT_LENGTH);

    const html = (await page.content()).slice(0, MAX_HTML_LENGTH);

    return {
      url,
      title: metadata.title || parsed.hostname,
      description: metadata.description ?? "",
      siteName: metadata.siteName,
      price: metadata.price,
      currency: metadata.currency,
      html,
      domSnapshot,
      screenshot,
      jsonLd: metadata.jsonLd,
      images,
      bodyText: bodyText.slice(0, MAX_BODY_TEXT_LENGTH),
    };
  });
}
