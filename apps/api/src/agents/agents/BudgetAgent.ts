import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, BudgetAgentOutput, ResearchContext } from "../types/index.js";

const DEFAULT_FALLBACK_BUDGET_CENTS = 5000;

const BUDGET_AGENT_TOOL = {
  name: "emit_budget_agent_result",
  description: "Return a recommended daily ad budget with an explicit reasoning chain.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendedDailyBudgetCents: { type: "integer", description: "e.g. 15000 for $150/day" },
      reasoning: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 6,
        description: "One reasoning step per array item, in order (competition -> CPC/CPA estimate -> clicks needed -> daily budget)",
      },
      riskFactors: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
    },
    required: ["recommendedDailyBudgetCents", "reasoning", "riskFactors"],
  },
};

const budgetAgentSchema: z.ZodType<BudgetAgentOutput> = z.object({
  recommendedDailyBudgetCents: z.number().int().nonnegative(),
  reasoning: z.array(z.string()),
  riskFactors: z.array(z.string()),
});

function fallback(): BudgetAgentOutput {
  return {
    recommendedDailyBudgetCents: DEFAULT_FALLBACK_BUDGET_CENTS,
    reasoning: ["No live market/competitor research available — using a conservative generic starting budget."],
    riskFactors: ["Budget not grounded in real CPC/CPA data"],
  };
}

/** Calculates a recommended daily budget with an explicit reasoning chain from
 * market/competitor research — independent of every other agent. */
export class BudgetAgent implements AIAgent<BudgetAgentOutput> {
  readonly name = "budget-agent";
  readonly promptId = "budget-agent";

  async execute(context: ResearchContext): Promise<AgentResult<BudgetAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["market", "competitors", "funding"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          market: JSON.stringify(context.market ?? {}),
          competitors: JSON.stringify(context.competitors ?? {}),
          funding: JSON.stringify(context.funding ?? {}),
        },
        tool: BUDGET_AGENT_TOOL,
        schema: budgetAgentSchema,
        maxTokens: 768,
        fallback,
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: collectEvidence(context, [...fields]),
      };
    });
  }
}
