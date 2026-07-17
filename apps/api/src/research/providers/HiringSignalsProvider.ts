import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { HiringSignalsData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const HIRING_SIGNALS_TOOL = {
  name: "emit_hiring_signals_analysis",
  description: "Return a structured read of a business's current hiring activity as a growth signal.",
  input_schema: {
    type: "object" as const,
    properties: {
      openRolesEstimate: { type: "string", description: "e.g. \"~25 open roles\"" },
      growthSignal: { type: "string", description: "1-2 sentences: what the hiring pace/pattern signals about growth trajectory" },
      keyDepartmentsHiring: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
    },
    required: ["growthSignal", "keyDepartmentsHiring"],
  },
};

/** Hiring/headcount growth signal — a real B2B buying-intent proxy (expanding teams often
 * mean expanding budgets), independent of every other provider. */
export class HiringSignalsProvider implements ResearchProvider<HiringSignalsData> {
  readonly name = "hiring-signals";
  readonly priority = 130;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<HiringSignalsData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<HiringSignalsData>({
        maxTokens: 768,
        tool: HIRING_SIGNALS_TOOL,
        searchPrompt: `Research current job openings/hiring activity at the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} (e.g. via LinkedIn Jobs, their careers page, Indeed). Roughly how many open roles, which departments are hiring most, and what does that signal about their growth trajectory?`,
        structurePrompt: (narrative) => `Using this web research, summarize hiring activity as a growth signal.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          growthSignal: "Unknown — no live research performed",
          keyDepartmentsHiring: [],
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
