import { firecrawlScrape } from "../../infra/firecrawlClient.js";
import { runSearch } from "../../infra/searchRouter.js";
import { resolveSearchTask } from "../../infra/searchTaskConfig.js";
import { runStructured } from "../../infra/llmClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, SocialMediaData } from "../types/index.js";
import { citationsToEvidence, hostnameOf, NO_CITATIONS_DATA_SOURCE, NO_SEARCH_DATA_SOURCE, runProviderStep, webSearchThenStructure } from "./support.js";
import { buildSearchQuery } from "./searchQuery.js";

const SOCIAL_DOMAINS = ["linkedin.com", "x.com", "twitter.com", "instagram.com", "facebook.com", "tiktok.com", "youtube.com"];
const MAX_PROFILES = 4;
const MAX_EXCERPT_LENGTH = 1500;

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

/**
 * A general web-research pass first (via llmClient.ts's runWebSearch), falling back to a
 * real profile crawl (searchRouter's "social-media-search" task, scoped to the major
 * platforms via includeDomains, + a Firecrawl scrape of the business's actual profile
 * page(s) for bio/caption text) only when the web-search leg didn't produce grounded
 * results. Realistic expectation: Instagram/TikTok/LinkedIn gate most content behind login
 * even for a real scrape, so this typically improves bio/meta-tag grounding rather than
 * full feed history.
 */
export class SocialMediaProvider implements ResearchProvider<SocialMediaData> {
  readonly name = "social-media";
  readonly priority = 100;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<SocialMediaData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = buildSearchQuery(input);

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

      const isFallback = data.dataSource === NO_SEARCH_DATA_SOURCE || data.dataSource === NO_CITATIONS_DATA_SOURCE;
      if (isFallback) {
        const grounded = await this.fromRealProfiles(query);
        if (grounded) return grounded;
      }

      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }

  private async fromRealProfiles(query: string): Promise<{ status: "success" | "partial"; data: SocialMediaData; evidence: { url: string; title?: string }[] } | null> {
    const assignment = resolveSearchTask("social-media-search");
    const searchResult = await runSearch(assignment, query, { includeDomains: SOCIAL_DOMAINS, maxResults: MAX_PROFILES });
    if (searchResult.searchesUsed === 0) return null;

    const excerpts: string[] = [];
    const evidence: { url: string; title?: string }[] = [];
    for (const profile of searchResult.results.slice(0, MAX_PROFILES)) {
      const scraped = await firecrawlScrape(profile.url, ["markdown"]);
      if (scraped.outage) break;
      if (scraped.data?.markdown) {
        excerpts.push(`### ${profile.title}\n${profile.url}\n${scraped.data.markdown.slice(0, MAX_EXCERPT_LENGTH)}`);
        evidence.push({ url: profile.url, title: profile.title });
      }
    }
    if (excerpts.length === 0) return null;

    const structured = await runStructured<Omit<SocialMediaData, "dataSource">>({
      maxTokens: 768,
      tool: SOCIAL_MEDIA_TOOL,
      messages: [{ role: "user", content: `Summarize the real social media presence for "${query}" from these actual profile page excerpts (note: some platforms only expose limited public content without login):\n\n${excerpts.join("\n\n")}` }],
    }).catch(() => null);
    if (!structured) return null;

    const data: SocialMediaData = { ...structured, dataSource: `Real profile pages (${evidence.map((e) => hostnameOf(e.url)).join(", ")})` };
    return { status: "success", data, evidence };
  }
}
