import { findProductNode, firstOffer, toPriceCents } from "./productParser.js";

export interface ResearchProductVariant {
  title?: string;
  price?: { amount?: number; currency?: string; formatted?: string };
  availability?: { inStock?: boolean; text?: string };
}

export interface ResearchProductShape {
  title?: string;
  brand?: string;
  category?: string;
  description?: string;
  variants?: ResearchProductVariant[];
}

/**
 * A slimmed, image-free reshape of a page's schema.org Product JSON-LD into the same
 * shape Firecrawl's `{type: "product"}` scrape format returns — used by the
 * research-fallback route (/research/scrape), never the product-import pipeline (which
 * uses the fuller parseProduct + classifyImages + LLM-normalization path instead).
 * Research providers only ever read `.title`/`.description`/`.variants[]` off a Firecrawl
 * product result (never `.brand`/`.category`/images), so this deliberately doesn't try to
 * match parseProduct's full RawProductDraft — just enough to keep those call sites unchanged.
 */
export function productFromJsonLd(jsonLd: unknown[]): ResearchProductShape | undefined {
  const productNode = findProductNode(jsonLd);
  if (!productNode) return undefined;

  const offer = firstOffer(productNode.offers);
  const priceCents = toPriceCents(offer?.price);
  const currency = typeof offer?.priceCurrency === "string" ? offer.priceCurrency : undefined;
  const availabilityRaw = typeof offer?.availability === "string" ? offer.availability : undefined;

  return {
    title: typeof productNode.name === "string" ? productNode.name : undefined,
    description: typeof productNode.description === "string" ? productNode.description : undefined,
    variants: [
      {
        title: typeof productNode.name === "string" ? productNode.name : undefined,
        price: priceCents !== undefined ? { amount: priceCents / 100, currency, formatted: currency ? `${(priceCents / 100).toFixed(2)} ${currency}` : undefined } : undefined,
        availability: availabilityRaw ? { text: availabilityRaw, inStock: /instock/i.test(availabilityRaw) } : undefined,
      },
    ],
  };
}
