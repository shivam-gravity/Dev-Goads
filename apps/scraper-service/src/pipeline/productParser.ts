import type { ImageClassification, RawProductDraft, ScrapedProduct } from "../types.js";

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node["@type"];
  return t === type || (Array.isArray(t) && t.includes(type));
}

function findProductNode(jsonLd: unknown[]): Record<string, unknown> | undefined {
  for (const node of jsonLd) {
    if (typeof node !== "object" || node === null) continue;
    const record = node as Record<string, unknown>;
    if (hasType(record, "Product")) return record;
    // Some sites nest the Product under @graph (schema.org graph format).
    const graph = record["@graph"];
    if (Array.isArray(graph)) {
      const nested = findProductNode(graph);
      if (nested) return nested;
    }
  }
  return undefined;
}

function toPriceCents(price: unknown): number | undefined {
  const value = typeof price === "string" ? Number(price) : typeof price === "number" ? price : undefined;
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100);
}

function firstOffer(offers: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(offers)) return (offers[0] as Record<string, unknown>) ?? undefined;
  if (typeof offers === "object" && offers !== null) return offers as Record<string, unknown>;
  return undefined;
}

/**
 * Deterministic best-effort read of the scrape — mainly schema.org JSON-LD
 * Product data, which most e-commerce platforms (Shopify, WooCommerce, etc.)
 * embed and which is authoritative when present. Falls back to page metadata.
 * The LLM Normalizer resolves whatever this leaves ambiguous or missing.
 */
export function parseProduct(site: ScrapedProduct, images: ImageClassification): RawProductDraft {
  const productNode = findProductNode(site.jsonLd);
  const offer = productNode ? firstOffer(productNode.offers) : undefined;

  const brand = productNode?.brand;
  const brandName = typeof brand === "string" ? brand : typeof brand === "object" && brand !== null ? (brand as Record<string, unknown>).name : undefined;

  const jsonLdImages = productNode?.image;
  const declaredImages = Array.isArray(jsonLdImages)
    ? jsonLdImages.filter((i): i is string => typeof i === "string")
    : typeof jsonLdImages === "string"
      ? [jsonLdImages]
      : [];
  // JSON-LD product images are first-party structured data — trusted as-is
  // over the validated hero/product candidates when present.
  const candidateImages = declaredImages.length > 0 ? declaredImages : [...images.heroImages, ...images.productImages];

  return {
    name: typeof productNode?.name === "string" ? productNode.name : site.title || undefined,
    description: typeof productNode?.description === "string" ? productNode.description : site.description || undefined,
    priceCents: toPriceCents(offer?.price) ?? toPriceCents(site.price),
    currency: (typeof offer?.priceCurrency === "string" ? offer.priceCurrency : undefined) ?? site.currency,
    brand: typeof brandName === "string" ? brandName : undefined,
    sku: typeof productNode?.sku === "string" ? productNode.sku : undefined,
    images: [...new Set(candidateImages)],
  };
}
