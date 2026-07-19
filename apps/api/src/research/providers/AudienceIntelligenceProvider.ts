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

      // One segment per genuinely distinct persona (report.personas — each with its own
      // pain point, motivation, and channels straight from the LLM synthesis). Previously
      // this reconstructed segments by zipping report.decisionMakers against motivations/
      // buyingTriggers via `i % length`, which visibly duplicated text across personas
      // whenever decisionMakers outnumbered the other arrays (index wraparound landing two
      // different roles on the same entry).
      const segments: AudienceSegmentData[] = report.personas.map((p) => ({
        name: p.role,
        description: [p.motivation, p.painPoint].filter(Boolean).join(" "),
        interests: p.channels,
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

      // Pass the engine's own fact-aware confidence through (see ProviderOutcome.confidence) so a
      // fact-grounded, citation-light result isn't docked to ~0.35 by the citation-based scorer.
      return { status: usedFallback ? "partial" : "success", data, citations: report.citations, evidence: citationsToEvidence(report.citations), confidence: usedFallback ? undefined : report.confidence };
    });
  }
}
