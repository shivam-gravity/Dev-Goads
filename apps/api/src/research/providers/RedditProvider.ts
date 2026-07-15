import { openai, runStructured } from "../../infra/openaiClient.js";
import { searchRedditThreads } from "../../infra/pullpushClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { CommunityDiscussionData, CommunityDiscussionThread, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, NO_CITATIONS_DATA_SOURCE, NO_SEARCH_DATA_SOURCE, runProviderStep, webSearchThenStructure } from "./support.js";
import { buildSearchQuery } from "./searchQuery.js";

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
          required: ["title", "sentiment"],
        },
      },
      summary: { type: "string", description: "1-2 sentences on what the community is actually saying" },
    },
    required: ["threads", "summary"],
  },
};

/**
 * OpenAI's own web search first, falling back to real Reddit threads via PullPush's
 * submission-search archive (infra/pullpushClient.ts) — used instead of Firecrawl, since
 * Reddit blocks Firecrawl's scrape of individual threads (and its own anonymous JSON
 * endpoints) far more often than not — only when the web-search leg didn't produce grounded
 * results, mirroring the same fallback-ordering pattern ReviewsProvider/SocialMediaProvider
 * already use. The one LLM call in the grounded path is justified the same way it is there:
 * turning raw thread text into a sentiment label/summary isn't a frequency heuristic.
 */
export class RedditProvider implements ResearchProvider<CommunityDiscussionData> {
  readonly name = "reddit";
  readonly priority = 216;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<CommunityDiscussionData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = buildSearchQuery(input);

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
    const threads = await searchRedditThreads(query, MAX_THREADS);
    if (!threads || threads.length === 0) return null;

    // PullPush already returns each post's full selftext in the same call that found it — no
    // separate per-thread scrape step needed. Posts with no selftext (link posts, not
    // self-posts) just don't contribute an excerpt, same as an empty scrape used to mean.
    const excerpts = threads.filter((t) => t.selftext.length > 0).map((t) => `### ${t.title}\n${t.url}\n${t.selftext.slice(0, MAX_EXCERPT_LENGTH)}`);

    if (!openai || excerpts.length === 0) {
      const fallbackThreads: CommunityDiscussionThread[] = threads.map((t) => ({ title: t.title, url: t.url, sentiment: "unknown — not analyzed" }));
      return {
        status: "partial",
        data: { threads: fallbackThreads, summary: "Found relevant threads but couldn't analyze sentiment (no OPENAI_API_KEY or no page text)", dataSource: "PullPush search (reddit.com), unanalyzed" },
      };
    }

    const structured = await runStructured<{ threads: CommunityDiscussionThread[]; summary: string }>({
      maxTokens: 640,
      tool: COMMUNITY_TOOL,
      messages: [{ role: "user", content: `Summarize genuine community sentiment about "${query}" from these real Reddit thread excerpts:\n\n${excerpts.join("\n\n")}` }],
    });

    if (!structured) {
      const fallbackThreads: CommunityDiscussionThread[] = threads.map((t) => ({ title: t.title, url: t.url, sentiment: "unknown" }));
      return { status: "partial", data: { threads: fallbackThreads, summary: "Found threads but sentiment analysis failed", dataSource: "PullPush search (reddit.com)" } };
    }

    const data: CommunityDiscussionData = { ...structured, dataSource: "PullPush search (reddit.com), analyzed" };
    return { status: "success", data };
  }
}
