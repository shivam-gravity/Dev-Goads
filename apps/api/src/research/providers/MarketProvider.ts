import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { MarketData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const MARKET_TOOL = {
  name: "emit_market_analysis",
  description: "Return a structured market-size, growth, and competition analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      marketSize: { type: "string", description: "e.g. \"$12B global TAM\"" },
      growthRate: { type: "string", description: "e.g. \"14% CAGR through 2028\"" },
      trends: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      recommendedRegion: { type: "string" },
      competitionLevel: { type: "string", description: "e.g. \"High — fragmented with several well-funded incumbents\"" },
    },
    required: ["trends", "competitionLevel"],
  },
};

/** Market size/growth/trend analysis — independent of every other provider, reasoning
 * purely from the target URL and industry (no dependency on WebsiteProvider's scrape). */
export class MarketProvider implements ResearchProvider<MarketData> {
  readonly name = "market";
  readonly priority = 40;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<MarketData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const industry = input.industry ?? "this business's category";
      const { status, data, citations } = await webSearchThenStructure<MarketData>({
        maxTokens: 1024,
        tool: MARKET_TOOL,
        websiteExcerpt: input.websiteExcerpt,
        searchPrompt: `Research the market size, growth rate, and competitive intensity for ${industry}, relevant to the business at ${input.url}. Find: (1) total addressable market size, (2) growth rate/CAGR, (3) 2-5 notable market trends, (4) overall competition level.`,
        structurePrompt: (narrative) => `Produce a structured market analysis for the market this business actually operates in — determine that market from the authoritative website content above, then use the web research below for sizing, growth, and trend figures.\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}\nIndustry: ${industry}`,
        fallback: () => ({
          trends: ["No live research performed — revisit once real market data is available"],
          competitionLevel: "Unknown — no live research performed",
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
