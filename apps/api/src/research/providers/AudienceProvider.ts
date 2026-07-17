import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { AudienceData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const AUDIENCE_TOOL = {
  name: "emit_audience_analysis",
  description: "Return a structured target-audience analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      primaryAudience: { type: "string" },
      segments: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] },
      },
      painPoints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      interestTags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
      ageDistribution: { type: "string" },
      genderRatio: { type: "string" },
    },
    required: ["primaryAudience", "segments", "painPoints", "interestTags"],
  },
};

interface AudienceToolOutput {
  primaryAudience: string;
  segments: { name: string; description: string }[];
  painPoints: string[];
  interestTags: string[];
  ageDistribution?: string;
  genderRatio?: string;
  dataSource?: string;
}

/** Target-audience/demographic analysis — independent of every other provider, reasoning
 * from the target URL/industry alone via live web search. */
export class AudienceProvider implements ResearchProvider<AudienceData> {
  readonly name = "audience";
  readonly priority = 60;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<AudienceData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const industry = input.industry ?? "this category";
      const { status, data: raw, citations } = await webSearchThenStructure<AudienceToolOutput>({
        maxTokens: 1024,
        tool: AUDIENCE_TOOL,
        searchPrompt: `Research the target audience/buyer profile for ${industry}, relevant to the business at ${input.url}. Find: (1) primary audience description, (2) 1-4 audience segments, (3) their pain points, (4) relevant ad-targeting interest categories, (5) age/gender distribution if available.`,
        structurePrompt: (narrative) => `Using this web research, produce a structured target-audience analysis.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}\nIndustry: ${industry}`,
        fallback: () => ({
          primaryAudience: `People interested in ${industry.toLowerCase()}`,
          segments: [{ name: "New customers", description: "First-time visitors evaluating the offering" }],
          painPoints: ["Uncertainty about which option fits their needs"],
          interestTags: [industry],
          dataSource: "",
        }),
      });

      const data: AudienceData = {
        primaryAudience: raw.primaryAudience,
        segments: raw.segments,
        painPoints: raw.painPoints,
        interestTags: raw.interestTags,
        demographics: raw.ageDistribution || raw.genderRatio ? { ageDistribution: raw.ageDistribution ?? "Unknown", genderRatio: raw.genderRatio ?? "Unknown" } : undefined,
        dataSource: raw.dataSource ?? "",
      };
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
