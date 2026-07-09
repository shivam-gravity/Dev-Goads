import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { CompetitorData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const COMPETITOR_TOOL = {
  name: "emit_competitor_analysis",
  description: "Return a structured competitor landscape.",
  input_schema: {
    type: "object" as const,
    properties: {
      competitors: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: { name: { type: "string" }, url: { type: "string" }, notes: { type: "string" } },
          required: ["name"],
        },
      },
      competitionIntensity: { type: "string" },
      differentiators: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
    },
    required: ["competitors", "competitionIntensity", "differentiators"],
  },
};

/** Named competitor landscape — independent of every other provider; identifies rivals
 * via live search on the target URL/industry alone. */
export class CompetitorProvider implements ResearchProvider<CompetitorData> {
  readonly name = "competitor";
  readonly priority = 50;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<CompetitorData>> {
    return runProviderStep(this.name, 1, async () => {
      const industry = input.industry ?? "its category";
      const { status, data, citations } = await webSearchThenStructure<CompetitorData>({
        maxTokens: 1024,
        tool: COMPETITOR_TOOL,
        searchPrompt: `Research the main named competitors of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} in ${industry}. Find real competitor names and, where possible, their URLs and what differentiates them.`,
        structurePrompt: (narrative) => `Using this web research, list named competitors and how this business could differentiate.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          competitors: [{ name: "Other providers in this category" }],
          competitionIntensity: "Unknown — no live research performed",
          differentiators: ["Distinct offering worth exploring further"],
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
