import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { AppStoreData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const APP_STORE_TOOL = {
  name: "emit_app_store_analysis",
  description: "Return a structured read of a business's mobile app presence, if any.",
  input_schema: {
    type: "object" as const,
    properties: {
      hasApp: { type: "boolean" },
      platforms: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3, description: "e.g. [\"iOS\", \"Android\"]" },
      ratingSummary: { type: "string", description: "e.g. \"4.6/5 across 12K ratings\"" },
      categoryRanking: { type: "string", description: "e.g. \"#3 in Productivity\"" },
    },
    required: ["hasApp", "platforms"],
  },
};

/** Mobile app store presence analysis — independent of every other provider, reasoning
 * from live search for the target business on the Apple App Store / Google Play. */
export class AppStoreProvider implements ResearchProvider<AppStoreData> {
  readonly name = "app-store";
  readonly priority = 160;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<AppStoreData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<AppStoreData>({
        maxTokens: 640,
        tool: APP_STORE_TOOL,
        searchPrompt: `Does the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} have a mobile app on the Apple App Store or Google Play? If so, what platforms, what's its rating/review summary, and where does it rank in its category?`,
        structurePrompt: (narrative) => `Using this web research, summarize the business's app store presence.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          hasApp: false,
          platforms: [],
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
