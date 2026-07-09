import { openai, runStructured } from "../openaiClient.js";
import type { NormalizedProduct, RawProductDraft, ScrapedProduct } from "../types.js";

const PRODUCT_TOOL = {
  name: "emit_normalized_product",
  description: "Return a structured, cleaned-up product record extracted from a scraped product page.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: { type: "string" },
      description: { type: "string", description: "1-2 sentence plain-language product description" },
      priceCents: { type: "integer", description: "Price in the smallest currency unit, if determinable" },
      currency: { type: "string", description: "ISO 4217 currency code, e.g. USD" },
      category: { type: "string" },
      keyFeatures: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
      variants: { type: "array", items: { type: "string" }, description: "e.g. sizes/colors — empty array if none" },
      images: {
        type: "array",
        items: { type: "string" },
        description: "The subset of the candidate image URLs that actually depict the product",
      },
    },
    required: ["name", "description", "category", "keyFeatures", "variants", "images"],
  },
};

function fallbackNormalizedProduct(draft: RawProductDraft, site: ScrapedProduct): NormalizedProduct {
  return {
    name: draft.name || site.title,
    description: draft.description || site.description || `Product page at ${site.url}`,
    priceCents: draft.priceCents,
    currency: draft.currency,
    category: "General",
    keyFeatures: [],
    variants: [],
    images: draft.images,
  };
}

/**
 * Fills gaps in the Product Parser's deterministic draft (e.g. price wasn't in
 * JSON-LD, category needs inferring, features need summarizing from page text)
 * and cleans up what's there. Falls back to a passthrough of the draft if
 * OPENAI_API_KEY is unset.
 */
export async function normalizeProduct(draft: RawProductDraft, site: ScrapedProduct): Promise<NormalizedProduct> {
  if (!openai) return fallbackNormalizedProduct(draft, site);

  const result = await runStructured<NormalizedProduct>({
    maxTokens: 1024,
    tool: PRODUCT_TOOL,
    messages: [
      {
        role: "user",
        content: `Extract a clean, structured product record for this scraped product page. A deterministic parse of the page's JSON-LD is provided as a starting point — trust it where present, fill gaps or fix errors using the page text.

URL: ${site.url}

Deterministic draft:
${JSON.stringify(draft, null, 2)}

Candidate images:
${site.images.join("\n")}

Page text:
${site.bodyText}`,
      },
    ],
  });
  if (!result) throw new Error("Product normalization: model did not return structured output");
  return result;
}
