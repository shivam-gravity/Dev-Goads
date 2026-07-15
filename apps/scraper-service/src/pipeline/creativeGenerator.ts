import { llm, runStructured } from "../llmClient.js";
import type { AdCopyVariant, NormalizedProduct } from "../types.js";

const VARIANT_COUNT = 3;

const AD_COPY_TOOL = {
  name: "emit_ad_copy_variants",
  description: `Return ${VARIANT_COUNT} distinct ad copy variants for this product, each taking a different angle.`,
  input_schema: {
    type: "object" as const,
    properties: {
      variants: {
        type: "array",
        minItems: VARIANT_COUNT,
        maxItems: VARIANT_COUNT,
        items: {
          type: "object",
          properties: {
            headline: { type: "string", maxLength: 100 },
            body: { type: "string", maxLength: 500 },
            callToAction: { type: "string", maxLength: 50 },
          },
          required: ["headline", "body", "callToAction"],
        },
      },
    },
    required: ["variants"],
  },
};

function fallbackAdCopy(product: NormalizedProduct): AdCopyVariant[] {
  return [{ headline: product.name, body: product.description, callToAction: "Shop now" }];
}

/** Falls back to a single generic variant if GROQ_API_KEY is unset. */
export async function generateAdCopy(product: NormalizedProduct): Promise<AdCopyVariant[]> {
  if (!llm) return fallbackAdCopy(product);

  const result = await runStructured<{ variants: AdCopyVariant[] }>({
    maxTokens: 1024,
    tool: AD_COPY_TOOL,
    messages: [
      {
        role: "user",
        content: `Write ${VARIANT_COUNT} distinct ad copy variants for this product, each taking a different angle (e.g. benefit-led, urgency, social proof).

Product:
${JSON.stringify(product, null, 2)}`,
      },
    ],
  });
  if (!result) throw new Error("Ad copy generation: model did not return structured output");
  return result.variants;
}
