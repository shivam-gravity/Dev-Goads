import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/db.js";
import type { CreativeAsset, AdCreative } from "../../types/index.js";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

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

export function listCreatives(businessId: string): CreativeAsset[] {
  const rows = db
    .prepare("SELECT data FROM creatives WHERE businessId = ? ORDER BY createdAt DESC")
    .all(businessId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}

export function getCreative(id: string): CreativeAsset | null {
  const row = db.prepare("SELECT data FROM creatives WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function createCreative(
  businessId: string,
  input: { headline: string; body: string; callToAction: string; format?: "text" | "image" | "video"; tags?: string[] }
): CreativeAsset {
  const creative: CreativeAsset = {
    id: randomUUID(),
    businessId,
    headline: input.headline,
    body: input.body,
    callToAction: input.callToAction,
    format: input.format ?? "text",
    tags: input.tags ?? [],
    createdAt: new Date().toISOString(),
  };

  db.prepare("INSERT INTO creatives (id, businessId, data, createdAt) VALUES (?, ?, ?, ?)").run(
    creative.id,
    creative.businessId,
    JSON.stringify(creative),
    creative.createdAt
  );

  return creative;
}

export function deleteCreative(id: string): boolean {
  const result = db.prepare("DELETE FROM creatives WHERE id = ?").run(id);
  return result.changes > 0;
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
  if (!anthropic) return fallbackVariations(base);

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    tools: [CREATIVE_VARIATION_TOOL],
    tool_choice: { type: "tool", name: "emit_creative_variations" },
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

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) return fallbackVariations(base);

  const result = toolUse.input as { variations: CreativeVariation[] };
  return result.variations;
}
