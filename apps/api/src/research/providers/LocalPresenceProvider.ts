import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { LocalPresenceData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const LOCAL_PRESENCE_TOOL = {
  name: "emit_local_presence_analysis",
  description: "Return a structured read of a business's physical/local presence, if any.",
  input_schema: {
    type: "object" as const,
    properties: {
      hasLocalPresence: { type: "boolean" },
      googleBusinessRating: { type: "string", description: "e.g. \"4.5/5 across 300 reviews\"" },
      locationsEstimate: { type: "string", description: "e.g. \"~12 locations across the Northeast US\"" },
      localSeoNotes: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
    },
    required: ["hasLocalPresence", "localSeoNotes"],
  },
};

/** Physical/local presence analysis (Google Business Profile, location count) —
 * independent of every other provider, most relevant to location-based businesses. */
export class LocalPresenceProvider implements ResearchProvider<LocalPresenceData> {
  readonly name = "local-presence";
  readonly priority = 180;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<LocalPresenceData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<LocalPresenceData>({
        maxTokens: 640,
        tool: LOCAL_PRESENCE_TOOL,
        searchPrompt: `Does the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} have a physical/local presence (Google Business Profile, physical locations)? If so, what's their Google rating, roughly how many locations, and any notable local SEO signals?`,
        structurePrompt: (narrative) => `Using this web research, summarize the business's local presence.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          hasLocalPresence: false,
          localSeoNotes: [],
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
