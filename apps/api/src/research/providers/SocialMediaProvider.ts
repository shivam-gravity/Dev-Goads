import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, SocialMediaData } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const SOCIAL_MEDIA_TOOL = {
  name: "emit_social_media_analysis",
  description: "Return a structured summary of a business's social media presence.",
  input_schema: {
    type: "object" as const,
    properties: {
      platforms: {
        type: "array",
        minItems: 0,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            platform: { type: "string", description: "e.g. LinkedIn, Twitter/X, Instagram, Facebook, TikTok, YouTube" },
            handle: { type: "string" },
            followers: { type: "string", description: "Approximate follower count, e.g. \"~45K\"" },
            engagementLevel: { type: "string", description: "e.g. \"High — frequent replies and shares\"" },
          },
          required: ["platform"],
        },
      },
      overallPresence: { type: "string", description: "1-2 sentence summary of how strong/active their social presence is overall" },
    },
    required: ["platforms", "overallPresence"],
  },
};

/** Social media presence/engagement analysis — independent of every other provider,
 * reasoning from live search on the target URL/business name alone. */
export class SocialMediaProvider implements ResearchProvider<SocialMediaData> {
  readonly name = "social-media";
  readonly priority = 100;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<SocialMediaData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const { status, data, citations } = await webSearchThenStructure<SocialMediaData>({
        maxTokens: 768,
        tool: SOCIAL_MEDIA_TOOL,
        searchPrompt: `What is the social media presence of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""}? Find which platforms (LinkedIn, Twitter/X, Instagram, Facebook, TikTok, YouTube) they're active on, approximate follower counts if discoverable, and how engaged their audience seems.`,
        structurePrompt: (narrative) => `Using this web research, summarize the business's social media presence.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          platforms: [],
          overallPresence: "Unknown — no live research performed",
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
