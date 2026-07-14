import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { AudienceData, AudienceSegmentData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { runAudienceIntelligence } from "../audience-intelligence/AudienceIntelligenceEngine.js";
import { citationsToEvidence, NO_CITATIONS_DATA_SOURCE, NO_SEARCH_DATA_SOURCE, runProviderStep } from "./support.js";

/**
 * Adapts the Audience Intelligence Engine (ICP + decision-maker/buying-trigger/objection
 * synthesis from a direct search AND a real review/complaint-site search, plus Research
 * Memory corroboration — research/audience-intelligence/AudienceIntelligenceEngine.ts)
 * into the `AudienceData` shape the 9-provider pipeline already expects, replacing the
 * older single-search AudienceProvider as the production "audience" slot.
 *
 * Does not pass `competitorNames` — every provider in this pipeline must be able to
 * produce its result from ResearchProviderInput alone, since the orchestrator runs all 9
 * concurrently with no inter-provider dependency (see ResearchProvider's doc comment).
 * The correlation with competitor data still happens, just one layer up: this provider's
 * AudienceData and CompetitorIntelligenceProvider's CompetitorData both land in the same
 * ResearchContext a moment later, where the Decision Engine and AI Agents read both
 * together — the engine's own competitor-aware prompting path is exercised when it's
 * invoked directly (see audienceIntelligenceEngine.test.ts), just not from inside this
 * concurrent provider fan-out.
 */
export class AudienceIntelligenceProvider implements ResearchProvider<AudienceData> {
  readonly name = "audience";
  readonly priority = 60;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<AudienceData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const report = await runAudienceIntelligence(input);
      const usedFallback = report.citations.length === 0 && report.confidence <= 0.1;

      // AudienceIntelligenceReport has no literal "segments" field — the closest real
      // structure it does have is one entry per decision-maker role, paired with the
      // motivation/buying-trigger most likely to apply to that role (cycled by index when
      // there are fewer of one than the other, so no segment is left without a description).
      const segments: AudienceSegmentData[] = report.decisionMakers.map((role, i) => ({
        name: role,
        description: [report.motivations[i % Math.max(report.motivations.length, 1)], report.buyingTriggers[i % Math.max(report.buyingTriggers.length, 1)]]
          .filter(Boolean)
          .join(" "),
      }));

      const dataSource = usedFallback
        ? NO_SEARCH_DATA_SOURCE
        : report.citations.length > 0
        ? report.citations.map((c) => c.title).join(" + ")
        : NO_CITATIONS_DATA_SOURCE;

      const data: AudienceData = {
        primaryAudience: report.icp.summary,
        segments: segments.length > 0 ? segments : [{ name: "General audience", description: report.icp.summary }],
        // Objections (why a prospect hesitates) are folded in alongside pain points —
        // AudienceData has no separate field for them, and both answer "what's stopping
        // this audience from converting," which is what downstream ad-copy generation
        // actually needs painPoints for.
        painPoints: [...report.painPoints, ...report.objections],
        interestTags: report.channels,
        buyingCommittee: report.buyingCommittee.length > 0 ? report.buyingCommittee : undefined,
        decisionHierarchy: report.decisionHierarchy,
        budgetOwner: report.budgetOwner,
        procurementCycle: report.procurementCycle,
        buyingTriggers: report.buyingTriggers,
        customerJourney: report.customerJourney.length > 0 ? report.customerJourney : undefined,
        dataSource,
      };

      return { status: usedFallback ? "partial" : "success", data, citations: report.citations, evidence: citationsToEvidence(report.citations) };
    });
  }
}
