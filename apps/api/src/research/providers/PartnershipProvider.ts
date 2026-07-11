import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { PartnershipData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const PARTNERSHIP_TOOL = {
  name: "emit_partnership_analysis",
  description: "Return a structured read of a business's technology partnerships/integrations.",
  input_schema: {
    type: "object" as const,
    properties: {
      integrations: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10, description: "Other tools/platforms they integrate with" },
      partners: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8, description: "Notable named business/technology partners" },
      ecosystemSummary: { type: "string", description: "1-2 sentences summarizing their ecosystem positioning" },
    },
    required: ["integrations", "partners", "ecosystemSummary"],
  },
};

/** Technology partnership/integration ecosystem analysis — independent of every other
 * provider, reasoning from live search for the target business's named integrations. */
export class PartnershipProvider implements ResearchProvider<PartnershipData> {
  readonly name = "partnerships";
  readonly priority = 190;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<PartnershipData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<PartnershipData>({
        maxTokens: 768,
        tool: PARTNERSHIP_TOOL,
        searchPrompt: `Research the technology partnerships and integrations of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""}: what other tools/platforms do they integrate with, who are their notable named partners, and how would you summarize their ecosystem positioning?`,
        structurePrompt: (narrative) => `Using this web research, analyze the business's partnership/integration ecosystem.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          integrations: [],
          partners: [],
          ecosystemSummary: "Unknown — no live research performed",
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
