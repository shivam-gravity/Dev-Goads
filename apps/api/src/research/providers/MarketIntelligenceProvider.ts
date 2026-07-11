import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { MarketData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { runMarketIntelligence } from "../market-intelligence/MarketIntelligenceEngine.js";
import { citationsToEvidence, NO_CITATIONS_DATA_SOURCE, NO_SEARCH_DATA_SOURCE, runProviderStep } from "./support.js";

/**
 * Adapts the Market Intelligence Engine (2 independent searches — growth/demand/
 * seasonality, and regulatory/emerging-competitor — plus a deterministic opportunity
 * score, research/market-intelligence/MarketIntelligenceEngine.ts) into the `MarketData`
 * shape the 9-provider pipeline already expects, replacing the older single-search
 * MarketProvider as the production "market" slot.
 *
 * MarketData itself isn't extended with new fields (no opportunityScore/regulations/
 * emergingCompetitors properties) to avoid changing a type every other provider/consumer
 * already relies on — the richer findings are folded into the existing marketSize/
 * trends/competitionLevel strings instead, same approach CompetitorIntelligenceProvider
 * takes with CompetitorEntry.notes.
 */
export class MarketIntelligenceProvider implements ResearchProvider<MarketData> {
  readonly name = "market";
  readonly priority = 40;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<MarketData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const report = await runMarketIntelligence(input);
      const usedFallback = report.citations.length === 0 && report.confidence <= 0.1;

      const regulatoryNote = report.regulations.length > 0 ? ` Regulatory factors: ${report.regulations.join("; ")}.` : "";
      const competitionLevel =
        report.emergingCompetitors.length > 0
          ? `${report.emergingCompetitors.length} emerging competitor(s) gaining traction: ${report.emergingCompetitors.slice(0, 3).join(", ")}. Opportunity score: ${report.opportunityScore}/100.${regulatoryNote}`
          : `No notable emerging competitors identified. Opportunity score: ${report.opportunityScore}/100.${regulatoryNote}`;

      const dataSource = usedFallback
        ? NO_SEARCH_DATA_SOURCE
        : report.citations.length > 0
        ? report.citations.map((c) => c.title).join(" + ")
        : NO_CITATIONS_DATA_SOURCE;

      const data: MarketData = {
        marketSize: report.currentMarket,
        growthRate: report.growth,
        trends: [...report.trends, `Demand: ${report.demand}`, `Seasonality: ${report.seasonality}`],
        competitionLevel,
        dataSource,
      };

      return { status: usedFallback ? "partial" : "success", data, citations: report.citations, evidence: citationsToEvidence(report.citations) };
    });
  }
}
