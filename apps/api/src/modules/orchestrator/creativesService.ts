import { randomUUID } from "node:crypto";
import { openai, runStructured } from "../../infra/openaiClient.js";
import { prisma } from "../../db/prisma.js";
import type { CreativeAsset, AdCreative } from "../../types/index.js";

const CREATIVE_VARIATION_TOOL = {
  name: "emit_creative_variations",
  description: "Generate 3 ad creative variations based on the provided creative.",
  input_schema: {
    type: "object" as const,
    properties: {
      variations: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            headline: { type: "string", description: "Attention-grabbing headline under 40 chars" },
            body: { type: "string", description: "Compelling ad body copy under 120 chars" },
            callToAction: { type: "string", description: "Short CTA text e.g. 'Get Started', 'Learn More'" },
            angle: { type: "string", description: "The creative angle used: e.g. 'fear of missing out', 'social proof', 'curiosity'" },
          },
          required: ["headline", "body", "callToAction", "angle"],
        },
      },
    },
    required: ["variations"],
  },
};

export async function listCreatives(businessId: string): Promise<CreativeAsset[]> {
  const rows = await prisma.creative.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as CreativeAsset);
}

export async function getCreative(id: string): Promise<CreativeAsset | null> {
  const row = await prisma.creative.findUnique({ where: { id } });
  return row ? (row.data as unknown as CreativeAsset) : null;
}

export async function createCreative(
  businessId: string,
  input: {
    headline: string;
    body: string;
    callToAction: string;
    format?: "text" | "image" | "video";
    tags?: string[];
    imageAssetId?: string;
    imageUrl?: string;
    videoAssetId?: string;
    videoUrl?: string;
  }
): Promise<CreativeAsset> {
  const creative: CreativeAsset = {
    id: randomUUID(),
    businessId,
    headline: input.headline,
    body: input.body,
    callToAction: input.callToAction,
    format: input.format ?? "text",
    tags: input.tags ?? [],
    createdAt: new Date().toISOString(),
    imageAssetId: input.imageAssetId,
    imageUrl: input.imageUrl,
    videoAssetId: input.videoAssetId,
    videoUrl: input.videoUrl,
  };

  await prisma.creative.create({
    data: { id: creative.id, businessId: creative.businessId, data: creative as any, createdAt: new Date(creative.createdAt) },
  });

  return creative;
}

export async function deleteCreative(id: string): Promise<boolean> {
  const result = await prisma.creative.deleteMany({ where: { id } });
  return result.count > 0;
}

export interface CreativeVariation extends AdCreative {
  angle: string;
}

function fallbackVariations(base: AdCreative): CreativeVariation[] {
  return [
    {
      headline: `${base.headline} — Proven Results`,
      body: `Join thousands who already trust us. ${base.body}`,
      callToAction: base.callToAction,
      angle: "social proof",
    },
    {
      headline: `Don't miss out: ${base.headline}`,
      body: `Limited time. ${base.body} Act now before it's gone.`,
      callToAction: "Claim Now",
      angle: "fear of missing out",
    },
    {
      headline: `What if ${base.headline.toLowerCase()}?`,
      body: `Imagine the results. ${base.body} Find out how.`,
      callToAction: "Discover More",
      angle: "curiosity",
    },
  ];
}

export async function generateCreativeVariations(base: AdCreative): Promise<CreativeVariation[]> {
  if (!openai) return fallbackVariations(base);

  const result = await runStructured<{ variations: CreativeVariation[] }>({
    maxTokens: 1024,
    tool: CREATIVE_VARIATION_TOOL,
    messages: [
      {
        role: "user",
        content: `Generate 3 distinct ad creative variations based on this ad:
Headline: ${base.headline}
Body: ${base.body}
CTA: ${base.callToAction}

Each variation should use a different persuasion angle (e.g. social proof, FOMO, curiosity, authority, benefit-led). Keep it punchy and platform-agnostic.`,
      },
    ],
  });
  if (!result) return fallbackVariations(base);
  return result.variations;
}
