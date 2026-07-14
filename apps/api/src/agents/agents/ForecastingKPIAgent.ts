import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, ForecastingKPIAgentOutput, ResearchContext } from "../types/index.js";

const FORECASTING_KPI_AGENT_TOOL = {
  name: "emit_forecasting_kpi_agent_result",
  description: "Return expected performance benchmark ranges and the primary KPI to optimize toward.",
  input_schema: {
    type: "object" as const,
    properties: {
      expectedCtrRange: { type: "string", description: "e.g. \"1.2% - 2.5%\"" },
      expectedCpaRange: { type: "string", description: "e.g. \"$18 - $35\"" },
      expectedRoasRange: { type: "string", description: "e.g. \"2.5x - 4x\"" },
      primaryKpi: { type: "string", description: "Which single metric this campaign should be judged on, and why" },
      benchmarkReasoning: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 6,
        description: "Reasoning chain: competition level -> category norms -> why these ranges are plausible for this business specifically",
      },
    },
    required: ["expectedCtrRange", "expectedCpaRange", "expectedRoasRange", "primaryKpi", "benchmarkReasoning"],
  },
};

const forecastingKPIAgentSchema: z.ZodType<ForecastingKPIAgentOutput> = z.object({
  expectedCtrRange: z.string(),
  expectedCpaRange: z.string(),
  expectedRoasRange: z.string(),
  primaryKpi: z.string(),
  benchmarkReasoning: z.array(z.string()),
});

function fallback(): ForecastingKPIAgentOutput {
  return {
    expectedCtrRange: "Unknown — no live market/competitor research available.",
    expectedCpaRange: "Unknown — no live market/competitor research available.",
    expectedRoasRange: "Unknown — no live market/competitor research available.",
    primaryKpi: "CPA",
    benchmarkReasoning: ["No live research available — using a generic placeholder KPI"],
  };
}

/** Forecasts expected performance benchmark RANGES (CTR/CPA/ROAS) and names the primary
 * KPI to optimize toward — distinct from BudgetAgent (which sets a $ amount) and
 * MarketAgent (which scores opportunity), independent of every other agent. Every range
 * carries an explicit reasoning chain rather than a bare number, same principle as
 * BudgetAgent's reasoning field. */
export class ForecastingKPIAgent implements AIAgent<ForecastingKPIAgentOutput> {
  readonly name = "forecasting-kpi-agent";
  readonly promptId = "forecasting-kpi-agent";

  async execute(context: ResearchContext): Promise<AgentResult<ForecastingKPIAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["market", "competitors", "hiringSignals"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          market: JSON.stringify(context.market ?? {}),
          competitors: JSON.stringify(context.competitors ?? {}),
          hiringSignals: JSON.stringify(context.hiringSignals ?? {}),
        },
        tool: FORECASTING_KPI_AGENT_TOOL,
        schema: forecastingKPIAgentSchema,
        maxTokens: 768,
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
