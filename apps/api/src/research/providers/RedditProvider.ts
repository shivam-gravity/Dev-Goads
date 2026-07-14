import { openai, runStructured } from "../../infra/openaiClient.js";
import { firecrawlScrape, firecrawlSearch, outageDataSource } from "../../infra/firecrawlClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { CommunityDiscussionData, CommunityDiscussionThread, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { hostnameOf, runProviderStep } from "./support.js";

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

/** Real Reddit threads via firecrawlSearch (includeDomains-scoped) + firecrawlScrape of the top
 * matches — genuine unfiltered community sentiment, not an LLM guess. The one LLM call here is
 * justified the same way SEOProvider's isn't and RedditProvider's is: turning raw thread text into
 * a sentiment label/summary isn't a frequency heuristic. */
export class RedditProvider implements ResearchProvider<CommunityDiscussionData> {
  readonly name = "reddit";
  readonly priority = 216;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<CommunityDiscussionData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = input.businessName ?? hostnameOf(input.url).replace(/^www\./i, "").split(".")[0];
      const searchResult = await firecrawlSearch(query, { includeDomains: ["reddit.com"], limit: MAX_THREADS });
      if (searchResult.outage) {
        return { status: "partial", data: { threads: [], summary: "Not researched", dataSource: outageDataSource(searchResult.outage) } };
      }
      if (searchResult.web.length === 0) {
        return { status: "partial", data: { threads: [], summary: "No relevant Reddit discussion found", dataSource: "Firecrawl search (reddit.com) — no results" } };
      }

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
    });
  }
}
