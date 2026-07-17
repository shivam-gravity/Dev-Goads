import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { LegalRegulatoryData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const LEGAL_REGULATORY_TOOL = {
  name: "emit_legal_regulatory_analysis",
  description: "Return a structured read of the legal/regulatory landscape relevant to a business's industry.",
  input_schema: {
    type: "object" as const,
    properties: {
      applicableRegulations: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8, description: "e.g. GDPR, HIPAA, PCI-DSS, CCPA, industry-specific licensing" },
      industrySpecificRisks: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
      complianceSummary: { type: "string", description: "1-2 sentences summarizing the overall regulatory burden" },
    },
    required: ["applicableRegulations", "industrySpecificRisks", "complianceSummary"],
  },
};

/** Legal/regulatory landscape analysis — independent of every other provider, reasoning
 * from live search about the target business's industry-specific compliance obligations. */
export class LegalRegulatoryProvider implements ResearchProvider<LegalRegulatoryData> {
  readonly name = "legal-regulatory";
  readonly priority = 200;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<LegalRegulatoryData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const industry = input.industry ?? "its category";
      const { status, data, citations } = await webSearchThenStructure<LegalRegulatoryData>({
        maxTokens: 768,
        tool: LEGAL_REGULATORY_TOOL,
        searchPrompt: `Research the legal/regulatory landscape relevant to the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} and its industry (${industry}): which regulations apply (e.g. GDPR, HIPAA, PCI-DSS, CCPA, industry-specific licensing), what compliance risks are notable, and summarize the overall regulatory burden.`,
        structurePrompt: (narrative) => `Using this web research, analyze the business's regulatory landscape.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}\nIndustry: ${industry}`,
        fallback: () => ({
          applicableRegulations: [],
          industrySpecificRisks: ["Not yet researched"],
          complianceSummary: "Unknown — no live research performed",
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
