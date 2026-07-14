import { openai, runStructured } from "../../infra/openaiClient.js";
import { firecrawlScrape, firecrawlSearch } from "../../infra/firecrawlClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { CommunityDiscussionData, CommunityDiscussionThread, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, hostnameOf, NO_CITATIONS_DATA_SOURCE, NO_SEARCH_DATA_SOURCE, runProviderStep, webSearchThenStructure } from "./support.js";

const MAX_THREADS = 3;
const MAX_EXCERPT_LENGTH = 2000;

const COMMUNITY_TOOL = {
  name: "emit_community_discussion",
  description: "Summarize genuine Reddit discussion about a business from real thread excerpts.",
  input_schema: {
    type: "object" as const,
    properties: {
      threads: {
        type: "array",
        maxItems: MAX_THREADS,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            sentiment: { type: "string", description: "one short phrase, e.g. 'mostly positive', 'mixed — pricing complaints', 'skeptical'" },
          },
          required: ["title", "url", "sentiment"],
        },
      },
      summary: { type: "string", description: "1-2 sentences on what the community is actually saying" },
    },
    required: ["threads", "summary"],
  },
};

/**
 * OpenAI's own web search first (costs no Firecrawl credit), falling back to real Reddit
 * threads via firecrawlSearch (includeDomains-scoped) + firecrawlScrape of the top matches
 * only when the web-search leg didn't produce grounded results — mirrors the same
 * fallback-ordering pattern ReviewsProvider/SocialMediaProvider already use. The one LLM
 * call in the grounded path is justified the same way it is there: turning raw thread text
 * into a sentiment label/summary isn't a frequency heuristic.
 */
export class RedditProvider implements ResearchProvider<CommunityDiscussionData> {
  readonly name = "reddit";
  readonly priority = 216;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<CommunityDiscussionData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = input.businessName ?? hostnameOf(input.url).replace(/^www\./i, "").split(".")[0];

      const { status, data, citations } = await webSearchThenStructure<CommunityDiscussionData>({
        maxTokens: 640,
        tool: COMMUNITY_TOOL,
        searchPrompt: `Find genuine Reddit discussion about the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""}. What are people saying, and what's the overall sentiment?`,
        structurePrompt: (narrative) => `Using this web research, summarize genuine community sentiment.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({ threads: [], summary: "Not yet researched", dataSource: "" }),
      });

      const isFallback = data.dataSource === NO_SEARCH_DATA_SOURCE || data.dataSource === NO_CITATIONS_DATA_SOURCE;
      if (isFallback) {
        const grounded = await this.fromRealThreads(query);
        if (grounded) return grounded;
      }

      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }

  private async fromRealThreads(query: string): Promise<{ status: "success" | "partial"; data: CommunityDiscussionData } | null> {
    const searchResult = await firecrawlSearch(query, { includeDomains: ["reddit.com"], limit: MAX_THREADS });
    if (searchResult.outage || searchResult.web.length === 0) return null;

    const excerpts: string[] = [];
    for (const thread of searchResult.web.slice(0, MAX_THREADS)) {
      const scraped = await firecrawlScrape(thread.url, ["markdown"]);
      if (scraped.outage) break;
      if (scraped.data?.markdown) excerpts.push(`### ${thread.title}\n${thread.url}\n${scraped.data.markdown.slice(0, MAX_EXCERPT_LENGTH)}`);
    }

    if (!openai || excerpts.length === 0) {
      const threads: CommunityDiscussionThread[] = searchResult.web.slice(0, MAX_THREADS).map((t) => ({ title: t.title, url: t.url, sentiment: "unknown — not analyzed" }));
      return {
        status: "partial",
        data: { threads, summary: "Found relevant threads but couldn't analyze sentiment (no OPENAI_API_KEY or no page text)", dataSource: "Firecrawl search (reddit.com), unanalyzed" },
      };
    }

    const structured = await runStructured<{ threads: CommunityDiscussionThread[]; summary: string }>({
      maxTokens: 640,
      tool: COMMUNITY_TOOL,
      messages: [{ role: "user", content: `Summarize genuine community sentiment about "${query}" from these real Reddit thread excerpts:\n\n${excerpts.join("\n\n")}` }],
    });

    if (!structured) {
      const threads: CommunityDiscussionThread[] = searchResult.web.slice(0, MAX_THREADS).map((t) => ({ title: t.title, url: t.url, sentiment: "unknown" }));
      return { status: "partial", data: { threads, summary: "Found threads but sentiment analysis failed", dataSource: "Firecrawl search (reddit.com)" } };
    }

    const data: CommunityDiscussionData = { ...structured, dataSource: "Firecrawl search + scrape (reddit.com), analyzed" };
    return { status: "success", data };
  }
}
