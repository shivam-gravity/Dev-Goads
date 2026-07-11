import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, VideoPresenceData } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const VIDEO_PRESENCE_TOOL = {
  name: "emit_video_presence_analysis",
  description: "Return a structured read of a business's YouTube/video content presence, if any.",
  input_schema: {
    type: "object" as const,
    properties: {
      hasYoutubeChannel: { type: "boolean" },
      subscriberEstimate: { type: "string", description: "e.g. \"~8K subscribers\"" },
      contentThemes: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
      engagementSummary: { type: "string", description: "1-2 sentences on how engaged their video audience seems" },
    },
    required: ["hasYoutubeChannel", "contentThemes", "engagementSummary"],
  },
};

/** YouTube/video content presence analysis — independent of every other provider,
 * reasoning from live search for the target business's video content. */
export class VideoPresenceProvider implements ResearchProvider<VideoPresenceData> {
  readonly name = "video-presence";
  readonly priority = 170;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<VideoPresenceData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<VideoPresenceData>({
        maxTokens: 640,
        tool: VIDEO_PRESENCE_TOOL,
        searchPrompt: `Does the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} have an active YouTube channel or other video content presence? If so, roughly how many subscribers, what themes/topics do their videos cover, and how engaged is their audience?`,
        structurePrompt: (narrative) => `Using this web research, summarize the business's video content presence.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          hasYoutubeChannel: false,
          contentThemes: [],
          engagementSummary: "Unknown — no live research performed",
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
