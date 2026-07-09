import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, TechnologyData } from "../types/index.js";
import { normalizeUrl, runProviderStep, withTimeout } from "./support.js";

const FETCH_TIMEOUT_MS = 8000;
const DATA_SOURCE = "Response headers + page markup signature detection";

/** Signature-based detection, cheapest-first: header value/HTML substring -> label.
 * Deliberately simple regex/substring matching rather than a fingerprinting library —
 * good enough to answer "what's this site built on" for the handful of platforms that
 * cover the vast majority of small/mid business sites. */
const CMS_SIGNATURES: Array<[RegExp, string]> = [
  [/wp-content|wp-includes/i, "WordPress"],
  [/cdn\.shopify\.com|Shopify\.theme/i, "Shopify"],
  [/static\.wixstatic\.com/i, "Wix"],
  [/squarespace/i, "Squarespace"],
  [/webflow/i, "Webflow"],
  [/cdn\.prod\.website-files\.com/i, "Webflow"],
  [/\/sites\/g\/files\/|drupal/i, "Drupal"],
  [/wp-json/i, "WordPress"],
];

const ECOMMERCE_SIGNATURES: Array<[RegExp, string]> = [
  [/cdn\.shopify\.com/i, "Shopify"],
  [/woocommerce/i, "WooCommerce"],
  [/Magento/i, "Magento"],
  [/bigcommerce/i, "BigCommerce"],
];

const ANALYTICS_SIGNATURES: Array<[RegExp, string]> = [
  [/www\.googletagmanager\.com\/gtm\.js/i, "Google Tag Manager"],
  [/www\.google-analytics\.com\/analytics\.js|gtag\('config'/i, "Google Analytics"],
  [/connect\.facebook\.net.+fbevents\.js/i, "Meta Pixel"],
  [/cdn\.segment\.com/i, "Segment"],
  [/js\.hs-scripts\.com|hubspot/i, "HubSpot"],
  [/static\.hotjar\.com/i, "Hotjar"],
];

const FRAMEWORK_SIGNATURES: Array<[RegExp, string]> = [
  [/__NEXT_DATA__/i, "Next.js"],
  [/data-reactroot|react-dom/i, "React"],
  [/ng-version=/i, "Angular"],
  [/__NUXT__/i, "Nuxt.js"],
  [/id="__svelte"/i, "Svelte"],
];

function matchAll(html: string, signatures: Array<[RegExp, string]>): string[] {
  const found = new Set<string>();
  for (const [pattern, label] of signatures) if (pattern.test(html)) found.add(label);
  return [...found];
}

function matchFirst(html: string, signatures: Array<[RegExp, string]>): string | undefined {
  return matchAll(html, signatures)[0];
}

/**
 * Detects the target site's tech stack (CMS, ecommerce platform, analytics/marketing
 * pixels, frontend framework, hosting) from response headers and page markup — its own
 * lightweight single-page fetch rather than reusing WebsiteProvider's multi-page crawl,
 * since technology signatures are reliably present on the homepage alone and a second
 * heavy crawl would be wasted work. Independent of every other provider by construction.
 */
export class TechnologyProvider implements ResearchProvider<TechnologyData> {
  readonly name = "technology";
  readonly priority = 70;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<TechnologyData>> {
    return runProviderStep(this.name, 1, async () => {
      const url = normalizeUrl(input.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let html: string;
      let headers: Headers;
      try {
        const res = await withTimeout(
          fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AdGoResearchBot/1.0)" } }),
          FETCH_TIMEOUT_MS,
          "TechnologyProvider fetch"
        );
        if (!res.ok) throw new Error(`Site responded with ${res.status}`);
        headers = res.headers;
        html = await res.text();
      } finally {
        clearTimeout(timer);
      }

      const server = headers.get("server") ?? undefined;
      const poweredBy = headers.get("x-powered-by") ?? undefined;
      const hostingProvider =
        (server && /cloudflare/i.test(server) && "Cloudflare") ||
        (server && /vercel/i.test(server) && "Vercel") ||
        (headers.get("x-vercel-id") && "Vercel") ||
        (headers.get("x-amz-cf-id") && "Amazon CloudFront") ||
        server ||
        undefined;

      const detectedFrom: string[] = [];
      if (server) detectedFrom.push(`Server: ${server}`);
      if (poweredBy) detectedFrom.push(`X-Powered-By: ${poweredBy}`);
      detectedFrom.push("page markup");

      const data: TechnologyData = {
        cms: matchFirst(html, CMS_SIGNATURES),
        ecommercePlatform: matchFirst(html, ECOMMERCE_SIGNATURES),
        analyticsTools: matchAll(html, ANALYTICS_SIGNATURES),
        frameworks: matchAll(html, FRAMEWORK_SIGNATURES),
        hostingProvider: hostingProvider || undefined,
        detectedFrom,
        dataSource: DATA_SOURCE,
      };

      const foundAnything = Boolean(data.cms || data.ecommercePlatform || data.hostingProvider || data.analyticsTools.length || data.frameworks.length);
      return { status: foundAnything ? "success" : "partial", data };
    });
  }
}
