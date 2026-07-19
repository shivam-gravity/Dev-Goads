import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { MarketData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, structureFromFacts, webSearchThenStructure } from "./support.js";

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

      // Fact-first: the plain "market size for X" search drifted to the WRONG market on this run
      // (it returned generic "AI service marketplaces / telecom / civic services" for what is
      // actually a CRM/sales-tech product). The verified facts pin down the real category, so
      // reason the market analysis from them — the model knows the CRM/sales-software market's
      // size, growth, and real competitors from general knowledge, anchored to the true category
      // rather than a mis-targeted search. Fall through to search only if facts yield nothing.
      if (input.verifiedFacts && input.verifiedFacts.length > 0) {
        const factResult = await structureFromFacts<MarketData>({
          facts: input.verifiedFacts,
          targetUrl: input.url,
          websiteExcerpt: input.websiteExcerpt,
          maxTokens: 1024,
          tool: MARKET_TOOL,
          structurePrompt: () => `From the verified facts above, first identify the SPECIFIC market/category this business competes in (be precise — e.g. "AI-powered CRM / sales automation software", not a vague "services" market). Then give that market's size (TAM), growth rate/CAGR, 2-5 real trends, the recommended primary region, and competition level. Ground everything in the actual product the facts describe.`,
        });
        if (factResult && (factResult.data.trends?.length || factResult.data.marketSize)) {
          return { ...factResult, evidence: citationsToEvidence(factResult.citations) };
        }
      }

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
