import Anthropic from "@anthropic-ai/sdk";
import type { AdCopyVariant, NormalizedProduct } from "../types.js";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
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

/** Falls back to a single generic variant if ANTHROPIC_API_KEY is unset. */
export async function generateAdCopy(product: NormalizedProduct): Promise<AdCopyVariant[]> {
  if (!anthropic) return fallbackAdCopy(product);

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    tools: [AD_COPY_TOOL],
    tool_choice: { type: "tool", name: "emit_ad_copy_variants" },
    messages: [
      {
        role: "user",
        content: `Write ${VARIANT_COUNT} distinct ad copy variants for this product, each taking a different angle (e.g. benefit-led, urgency, social proof).

Product:
${JSON.stringify(product, null, 2)}`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Ad copy generation: model did not return structured output");
  return (toolUse.input as { variants: AdCopyVariant[] }).variants;
}
