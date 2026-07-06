import type { ImageClassification, ScrapedImageCandidate } from "../types.js";

const CHECK_TIMEOUT_MS = 5000;
const MAX_VALID_PRODUCT_IMAGES = 8;
const MAX_VALID_HERO_IMAGES = 2;
const CONCURRENCY = 4;

// Non-product image paths (tracking pixels, icon sprites, spinners) that
// survive the Scrape Worker's <img> sweep but shouldn't reach the LLM as
// candidate product photos. Header/logo images are handled separately below,
// not treated as noise.
const NOISE_PATTERN = /\b(sprite|icon|favicon|pixel|spinner|placeholder)\b/i;

async function isReachableImage(url: string): Promise<boolean> {
  // Self-contained (see the inline-SVG logo capture in scrapeWorker.ts) — not
  // a network resource, so there's nothing to check reachability of.
  if (url.startsWith("data:image/")) return true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (!res.ok) return false;
    const contentType = res.headers.get("content-type") ?? "";
    return contentType.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function filterReachable(urls: string[], max: number): Promise<string[]> {
  const deduped = [...new Set(urls)];
  const valid: string[] = [];

  for (let i = 0; i < deduped.length && valid.length < max; i += CONCURRENCY) {
    const batch = deduped.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (url) => ((await isReachableImage(url)) ? url : null)));
    valid.push(...results.filter((url): url is string => url !== null));
  }

  return valid.slice(0, max);
}

async function firstReachable(urls: string[]): Promise<string | undefined> {
  return (await filterReachable(urls, 1))[0];
}

/**
 * Validates the Scrape Worker's raw candidates (a page can list a stale CDN
 * URL, a lazy-load placeholder that never resolved, or a duplicate) and
 * buckets them by role: the og:image as a hero candidate, the best-available
 * logo signal as a logo candidate, everything else as ordinary product images.
 */
export async function classifyImages(candidates: ScrapedImageCandidate[]): Promise<ImageClassification> {
  const heroUrls = candidates.filter((c) => c.source === "og").map((c) => c.url);
  const logoHomeUrls = candidates.filter((c) => c.source === "logo-home").map((c) => c.url);
  const logoNameUrls = candidates.filter((c) => c.source === "logo-name").map((c) => c.url);
  const logoPositionUrls = candidates.filter((c) => c.source === "logo-position").map((c) => c.url);
  const productUrls = candidates
    .filter((c) => c.source === "img")
    .map((c) => c.url)
    .filter((url) => !NOISE_PATTERN.test(url));

  const [heroImages, productImages] = await Promise.all([
    filterReachable(heroUrls, MAX_VALID_HERO_IMAGES),
    filterReachable(productUrls, MAX_VALID_PRODUCT_IMAGES),
  ]);

  // Tiered by reliability: an image linking to the homepage is almost always
  // the real logo; a "logo" name/alt match is next-best; bare header/nav
  // position (which also holds promo banners on many sites) is last resort.
  const logoCandidate =
    (await firstReachable(logoHomeUrls)) ?? (await firstReachable(logoNameUrls)) ?? (await firstReachable(logoPositionUrls));

  return { productImages, heroImages, logoCandidate };
}
