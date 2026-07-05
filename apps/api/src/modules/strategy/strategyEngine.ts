import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import type { AdStrategy, BusinessProfile } from "../../types/index.js";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const STRATEGY_TOOL = {
  name: "emit_ad_strategy",
  description: "Return a structured ad strategy for the given business.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "2-3 sentence strategy overview" },
      recommendedNetworks: {
        type: "array",
        items: { type: "string", enum: ["meta", "google", "tiktok"] },
      },
      budgetSplit: {
        type: "object",
        properties: { meta: { type: "number" }, google: { type: "number" }, tiktok: { type: "number" } },
        required: ["meta", "google"],
      },
      audiences: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      creatives: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
            callToAction: { type: "string" },
          },
          required: ["headline", "body", "callToAction"],
        },
      },
    },
    required: ["summary", "recommendedNetworks", "budgetSplit", "audiences", "creatives"],
  },
};

function fallbackStrategy(business: BusinessProfile): Omit<AdStrategy, "id" | "businessId" | "createdAt"> {
  return {
    summary: `A balanced acquisition strategy for ${business.name} in ${business.industry}, splitting spend across search intent capture and social awareness while validating creative angles against stated goals: ${business.goals.join(", ")}.`,
    recommendedNetworks: ["google", "meta"],
    budgetSplit: { meta: 0.5, google: 0.5 },
    audiences: [business.targetAudience ?? `${business.industry} decision makers`, "Lookalike of existing customers", "Retargeting: site visitors (30d)"],
    creatives: [
      { headline: `${business.name}: Built for ${business.industry}`, body: "See why teams switch to us in weeks, not quarters.", callToAction: "Get Started" },
      { headline: `Stop losing time to manual ${business.industry} work`, body: "Automate the busywork and focus on what matters.", callToAction: "Learn More" },
    ],
  };
}

export async function generateStrategy(business: BusinessProfile): Promise<AdStrategy> {
  let payload: Omit<AdStrategy, "id" | "businessId" | "createdAt">;

  if (anthropic) {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      tools: [STRATEGY_TOOL],
      tool_choice: { type: "tool", name: "emit_ad_strategy" },
      messages: [
        {
          role: "user",
          content: `Design a paid-ads strategy for this business:\n${JSON.stringify(business, null, 2)}\n\nBudget split values must be fractions that sum to 1.`,
        },
      ],
    });
    const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) throw new Error("Strategy engine: model did not return structured output");
    payload = toolUse.input as typeof payload;
  } else {
    payload = fallbackStrategy(business);
  }

  const strategy: AdStrategy = {
    id: randomUUID(),
    businessId: business.id,
    createdAt: new Date().toISOString(),
    ...payload,
  };

  await prisma.strategy.create({
    data: { id: strategy.id, businessId: strategy.businessId, data: strategy as any, createdAt: new Date(strategy.createdAt) },
  });

  return strategy;
}

export async function getStrategy(id: string): Promise<AdStrategy | null> {
  const row = await prisma.strategy.findUnique({ where: { id } });
  return row ? (row.data as unknown as AdStrategy) : null;
}

export async function listStrategiesForBusiness(businessId: string): Promise<AdStrategy[]> {
  const rows = await prisma.strategy.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as AdStrategy);
}
