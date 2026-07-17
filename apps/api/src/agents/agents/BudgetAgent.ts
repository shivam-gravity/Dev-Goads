import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, BudgetAgentOutput, ResearchContext } from "../types/index.js";

const DEFAULT_FALLBACK_BUDGET_CENTS = 5000;

const BUDGET_AGENT_TOOL = {
  name: "emit_budget_agent_result",
  description: "Return a genuine, market-calibrated daily ad budget with tiered recommendations and per-platform allocation.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendedDailyBudgetCents: { type: "integer", description: "GROWTH-tier daily budget in cents (e.g. 15000 for $150/day)" },
      testBudgetCents: { type: "integer", description: "Minimum viable TEST-tier daily budget in cents" },
      scaleBudgetCents: { type: "integer", description: "Aggressive SCALE-tier daily budget in cents" },
      platformSplit: {
        type: "object",
        properties: {
          meta: { type: "integer", description: "Percentage allocated to Meta Ads (0-100)" },
          google: { type: "integer", description: "Percentage allocated to Google Ads (0-100)" },
          tiktok: { type: "integer", description: "Percentage allocated to TikTok (0-100)" },
        },
        required: ["meta", "google"],
      },
      reasoning: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 8,
        description: "Step-by-step calculation: industry vertical -> CPC benchmarks -> clicks needed -> budget tiers -> platform split rationale",
      },
      expectedOutcomes: {
        type: "object",
        properties: {
          dailyClicks: { type: "integer" },
          dailyImpressions: { type: "integer" },
          estimatedCPACents: { type: "integer" },
          estimatedROAS: { type: "number" },
          monthlyConversions: { type: "integer" },
        },
      },
      riskFactors: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
    },
    required: ["recommendedDailyBudgetCents", "reasoning", "riskFactors"],
  },
};

const budgetAgentSchema: z.ZodType<BudgetAgentOutput> = z.object({
  recommendedDailyBudgetCents: z.number().int().nonnegative(),
  testBudgetCents: z.number().int().nonnegative().optional(),
  scaleBudgetCents: z.number().int().nonnegative().optional(),
  platformSplit: z.object({
    meta: z.number().int().min(0).max(100),
    google: z.number().int().min(0).max(100),
    tiktok: z.number().int().min(0).max(100).optional(),
  }).optional(),
  reasoning: z.array(z.string()),
  expectedOutcomes: z.object({
    dailyClicks: z.number().int().optional(),
    dailyImpressions: z.number().int().optional(),
    estimatedCPACents: z.number().int().optional(),
    estimatedROAS: z.number().optional(),
    monthlyConversions: z.number().int().optional(),
  }).optional(),
  riskFactors: z.array(z.string()),
});

function fallback(): BudgetAgentOutput {
  return {
    recommendedDailyBudgetCents: DEFAULT_FALLBACK_BUDGET_CENTS,
    reasoning: ["No live market/competitor research available — using a conservative generic starting budget."],
    riskFactors: ["Budget not grounded in real CPC/CPA data"],
  };
}

export class BudgetAgent implements AIAgent<BudgetAgentOutput> {
  readonly name = "budget-agent";
  readonly promptId = "budget-agent";

  async execute(context: ResearchContext): Promise<AgentResult<BudgetAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["market", "competitors", "funding", "audience"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          url: context.url ?? "",
          productCategory: context.company?.summary?.split(".")[0] ?? context.website?.title ?? "unknown",
          market: JSON.stringify(context.market ?? {}),
          competitors: JSON.stringify(context.competitors ?? {}),
          funding: JSON.stringify(context.funding ?? {}),
          audience: JSON.stringify(context.audience ?? {}),
        },
        tool: BUDGET_AGENT_TOOL,
        schema: budgetAgentSchema,
        maxTokens: 1200,
        fallback,
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        modelSource,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: collectEvidence(context, [...fields]),
      };
    });
  }
}
