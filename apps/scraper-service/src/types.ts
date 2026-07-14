export type ImageSource = "og" | "logo-home" | "logo-name" | "logo-position" | "img";

// A candidate image plus where on the page it came from — the Image Worker
// uses this to tell a hero/social image apart from a header logo apart from
// an ordinary body image, instead of validating one undifferentiated list.
export interface ScrapedImageCandidate {
  url: string;
  source: ImageSource;
}

// Output of the Scrape Worker — raw material pulled from the rendered page,
// before any cleanup/validation (Image Worker) or interpretation (Product Parser).
export interface ScrapedProduct {
  url: string;
  title: string;
  description: string;
  siteName?: string;
  price?: string;
  currency?: string;
  jsonLd: unknown[];
  images: ScrapedImageCandidate[];
  bodyText: string;
  html: string;
  // Accessibility-tree snapshot of the rendered DOM (see scrapeWorker.ts) —
  // a semantic, low-noise structural view distinct from raw `html`.
  domSnapshot: string;
  // base64 data URI of an above-the-fold viewport capture.
  screenshot: string;
  // Same-origin + cross-origin anchor hrefs found on the rendered page, deduped —
  // populated for every scrape; only the research-fallback consumer (apps/api's
  // scrapeFallback.ts) reads it today, the product-import pipeline doesn't.
  links: string[];
  // `html` converted to Markdown via turndown — lets Firecrawl-fallback consumers
  // that regex/LLM-prompt against a `.markdown` field keep their existing parsing
  // logic unchanged regardless of which backend served the scrape.
  markdown: string;
  // HTTP status of the final navigation response, when available.
  statusCode?: number;
}

// Output of the Image Worker — the Scrape Worker's raw candidates, validated
// (reachable, actually an image) and bucketed by role.
export interface ImageClassification {
  productImages: string[];
  heroImages: string[];
  logoCandidate?: string;
}

// Output of the Product Parser — a deterministic best-effort read of the scrape
// (mainly JSON-LD Product schema, when present), before the LLM Normalizer
// fills gaps and resolves ambiguity.
export interface RawProductDraft {
  name?: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  brand?: string;
  sku?: string;
  images: string[];
}

// Output of the LLM Normalizer.
export interface NormalizedProduct {
  name: string;
  description: string;
  priceCents?: number;
  currency?: string;
  category: string;
  keyFeatures: string[];
  variants: string[];
  images: string[];
}

export interface SimilarProduct {
  url: string;
  name: string;
  category: string;
  score: number;
}

// Output of the Creative Generator.
export interface AdCopyVariant {
  headline: string;
  body: string;
  callToAction: string;
}

export type AdNetwork = "meta" | "google" | "tiktok";

// Output of Campaign Suggestions.
export interface CampaignSuggestion {
  recommendedNetworks: AdNetwork[];
  budgetSplit: Partial<Record<AdNetwork, number>>;
  audiences: string[];
  rationale: string;
}
