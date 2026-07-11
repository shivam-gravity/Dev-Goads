import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { BacklinkAuthorityData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const BACKLINK_AUTHORITY_TOOL = {
  name: "emit_backlink_authority_analysis",
  description: "Return a structured read of a business's SEO domain authority/backlink profile.",
  input_schema: {
    type: "object" as const,
    properties: {
      domainAuthorityEstimate: { type: "string", description: "Qualitative read, e.g. \"Strong — widely cited by major industry publications\"" },
      notableBacklinkSources: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8, description: "Named publications/sites that link to or cite this business" },
      seoStrengthSummary: { type: "string", description: "1-2 sentences on what this means for organic reach" },
    },
    required: ["notableBacklinkSources", "seoStrengthSummary"],
  },
};

/** SEO domain authority / backlink profile analysis — independent of every other
 * provider, reasoning from live search for citations/mentions of the target business. */
export class BacklinkAuthorityProvider implements ResearchProvider<BacklinkAuthorityData> {
  readonly name = "backlink-authority";
  readonly priority = 150;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<BacklinkAuthorityData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<BacklinkAuthorityData>({
        maxTokens: 768,
        tool: BACKLINK_AUTHORITY_TOOL,
        searchPrompt: `Research the SEO domain authority / backlink profile of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""}: is it cited/linked by major publications or industry sites, roughly how strong is its overall search authority, and what does that mean for organic reach?`,
        structurePrompt: (narrative) => `Using this web research, analyze the business's SEO domain authority.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          notableBacklinkSources: [],
          seoStrengthSummary: "Unknown — no live research performed",
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
