import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { CompetitorData, CompetitorEntry, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { runCompetitorIntelligence } from "../competitor-intelligence/CompetitorIntelligenceEngine.js";
import { citationsToEvidence, NO_SEARCH_DATA_SOURCE, runProviderStep } from "./support.js";

/**
 * Adapts the Competitor Intelligence Engine (3-source discovery + per-competitor
 * enrichment + Knowledge Fusion drift detection — research/competitor-intelligence/*)
 * into the `CompetitorData` shape the 9-provider pipeline/ResearchContext/AI Agents
 * already expect, so the richer engine drives production instead of sitting test-only.
 * Strictly supersedes the old CompetitorProvider (still kept for its own unit tests and
 * as a documented reference implementation): every field CompetitorProvider produced is
 * still produced here, from genuinely deeper research (per-competitor technologyStack,
 * strengths/weaknesses, positioning, multi-source corroboration) rather than one search.
 */
export class CompetitorIntelligenceProvider implements ResearchProvider<CompetitorData> {
  readonly name = "competitor";
  readonly priority = 50;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<CompetitorData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const report = await runCompetitorIntelligence(input);

      if (report.competitors.length === 0) {
        return {
          status: "partial",
          data: {
            competitors: [{ name: "Other providers in this category" }],
            competitionIntensity: "Unknown — no competitors discovered",
            differentiators: ["Distinct offering worth exploring further"],
            dataSource: NO_SEARCH_DATA_SOURCE,
          },
        };
      }

      const competitors: CompetitorEntry[] = report.competitors.map((c) => ({
        name: c.name,
        url: c.url,
        notes: `${c.positioning} Pricing: ${c.pricing}. ${c.valueProposition}`.trim(),
        marketShare: c.marketShare,
        estimatedAdBudget: c.estimatedAdBudget,
        differentiation: c.differentiation,
      }));

      // Real, evidence-derived differentiation angles — where researched competitors'
      // own weaknesses cluster is where this business can credibly differentiate, read
      // directly from enrichment.ts's per-competitor findings, not a fresh LLM guess.
      const differentiators = [...new Set(report.competitors.flatMap((c) => c.weaknesses))].slice(0, 5);

      const competitionIntensity =
        report.competitors.length >= 4
          ? "High — multiple well-established named competitors found"
          : report.competitors.length >= 2
          ? "Moderate — a handful of named competitors found"
          : "Low — few named competitors surfaced";

      const citations = report.competitors.flatMap((c) => c.citations);

      const data: CompetitorData = {
        competitors,
        competitionIntensity,
        differentiators: differentiators.length > 0 ? differentiators : ["Distinct offering worth exploring further"],
        dataSource: report.sourcesUsed.join(" + "),
      };

      return { status: "success", data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
