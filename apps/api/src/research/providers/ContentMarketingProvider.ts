import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ContentMarketingData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const CONTENT_MARKETING_TOOL = {
  name: "emit_content_marketing_analysis",
  description: "Return a structured analysis of a business's content marketing/blog presence.",
  input_schema: {
    type: "object" as const,
    properties: {
      hasActiveBlog: { type: "boolean" },
      publishingCadence: { type: "string", description: "e.g. \"~2 posts/week\"" },
      contentPillars: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "Main recurring topics/themes" },
      contentGaps: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "Obvious topics their audience would want that they aren't covering" },
    },
    required: ["hasActiveBlog", "contentPillars", "contentGaps"],
  },
};

/** Content marketing/blog strategy analysis — independent of every other provider,
 * reasoning from live search of the target's own published content. */
export class ContentMarketingProvider implements ResearchProvider<ContentMarketingData> {
  readonly name = "content-marketing";
  readonly priority = 140;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<ContentMarketingData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<ContentMarketingData>({
        maxTokens: 768,
        tool: CONTENT_MARKETING_TOOL,
        searchPrompt: `Research the content marketing / blog presence of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""}: do they have an active blog, how often do they publish, what are their main content topics/pillars, and what obvious content gaps exist versus what their audience would want to read?`,
        structurePrompt: (narrative) => `Using this web research, analyze the business's content marketing strategy.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          hasActiveBlog: false,
          contentPillars: [],
          contentGaps: ["Not yet researched"],
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
