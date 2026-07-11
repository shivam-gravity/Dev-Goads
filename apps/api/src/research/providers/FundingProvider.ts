import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { FundingData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const FUNDING_TOOL = {
  name: "emit_funding_analysis",
  description: "Return a structured funding history for a business.",
  input_schema: {
    type: "object" as const,
    properties: {
      totalRaised: { type: "string", description: "e.g. \"$45M total raised\"" },
      latestRound: { type: "string", description: "e.g. \"Series B, $30M, 2023\"" },
      investors: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
      valuation: { type: "string", description: "Only if publicly disclosed" },
      fundingTimeline: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8, description: "e.g. [\"2019: Seed $2M\", \"2021: Series A $15M\"]" },
    },
    required: ["investors", "fundingTimeline"],
  },
};

/** Funding history/investor research — deeper than CompanyProvider's single fundingStage
 * field, independent of every other provider. */
export class FundingProvider implements ResearchProvider<FundingData> {
  readonly name = "funding";
  readonly priority = 120;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<FundingData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<FundingData>({
        maxTokens: 768,
        tool: FUNDING_TOOL,
        searchPrompt: `Research the funding history of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""}: total amount raised, most recent funding round, named investors/VCs, valuation if disclosed, and a timeline of funding events.`,
        structurePrompt: (narrative) => `Using this web research, produce a structured funding history.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          investors: [],
          fundingTimeline: ["No live research performed"],
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
