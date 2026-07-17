import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../modules/logger/logger.js";
import type { AdCreative } from "../../types/index.js";
import type { CampaignStrategy, DecisionContext, StrategySimulationResult } from "../decision/types.js";

/**
 * Campaign Recommendation Engine — assembles 6 ranked, fully-specified campaign packages
 * from data the pipeline has ALREADY computed: the Decision Engine's simulated/ranked
 * CampaignStrategy set, the AI Agent Coordinator's real generated ad creatives, and the
 * Landing Page Intelligence recommendation. Pure synthesis, no new research/LLM calls —
 * additive alongside (never replacing) the single Campaign the existing pipeline still
 * builds via buildCampaignFromStrategy.
 *
 * 6 recommendations = each of the Decision Engine's simulated strategies (typically 3),
 * paired with 2 different real creative executions each — every strategic direction the
 * Decision Engine actually considered is represented, not just the single winner.
 */

const TOTAL_RECOMMENDATIONS = 6;

export interface CampaignRecommendationPackage {
  rank: number;
  objective: string;
  platform: string;
  audience: string;
  dailyBudgetCents: number;
  campaignStructure: { adSetCount: number; structureNotes: string };
  adSets: { name: string; audience: string }[];
  creatives: AdCreative[];
  headlines: string[];
  primaryText: string;
  cta: string;
  landingPageRecommendation: string;
  confidenceScore: number;
  explanation: string;
}

export interface AssembleCampaignRecommendationsInput {
  strategies: CampaignStrategy[];
  simulations: StrategySimulationResult[];
  campaignAgentCreatives: AdCreative[];
  landingPageRecommendation: string;
}

const FALLBACK_CREATIVE: AdCreative = {
  headline: "Learn More Today",
  body: "Discover what makes us different.",
  callToAction: "Learn More",
};

/** Pure assembly — no I/O, so it's directly unit-testable. Always returns exactly
 * TOTAL_RECOMMENDATIONS packages when at least one strategy exists (cycling through
 * strategies/creatives via modulo so this never depends on there being exactly 3 of
 * either), sorted so `rank` always correlates with `confidenceScore` descending. */
export function assembleCampaignRecommendations(input: AssembleCampaignRecommendationsInput): CampaignRecommendationPackage[] {
  if (input.strategies.length === 0) return [];

  const creatives = input.campaignAgentCreatives.length > 0 ? input.campaignAgentCreatives : [FALLBACK_CREATIVE];

  const unranked = Array.from({ length: TOTAL_RECOMMENDATIONS }, (_, i) => {
    const strategy = input.strategies[i % input.strategies.length]!;
    // Which pass through the strategy list this is (0 = first creative pairing for every
    // strategy, 1 = second, ...) — a later pass gets a small confidence discount since it's
    // a secondary creative execution of an already-represented strategic direction.
    const variantWithinStrategy = Math.floor(i / input.strategies.length);
    const creative = creatives[i % creatives.length]!;
    const simulation = input.simulations.find((s) => s.strategyId === strategy.id);
    const confidenceScore = Math.round(Math.max((simulation?.overallScore ?? 50) / 100 - variantWithinStrategy * 0.03, 0.05) * 100) / 100;

    return {
      objective: strategy.objective,
      platform: strategy.platforms[0] ?? "meta",
      audience: strategy.targetAudience,
      dailyBudgetCents: strategy.budgetDailyCents,
      campaignStructure: {
        adSetCount: 1,
        structureNotes: `Single ad set targeting "${strategy.targetAudience}" on ${strategy.platforms.join(", ") || "the recommended channel"}.`,
      },
      adSets: [{ name: `${strategy.label} — ${creative.headline}`, audience: strategy.targetAudience }],
      creatives: [creative],
      headlines: [creative.headline],
      primaryText: creative.body,
      cta: creative.callToAction,
      landingPageRecommendation: input.landingPageRecommendation,
      confidenceScore,
      explanation:
        `${strategy.label} ranked #${simulation?.rank ?? "unranked"} of the simulated strategies ` +
        `(overall score ${Math.round(simulation?.overallScore ?? 0)}/100, expected ROI ${simulation?.expectedRoi ?? "n/a"}/100, ` +
        `competition ${simulation?.competition ?? "n/a"}/100). Paired here with the "${creative.headline}" creative angle.`,
    };
  });

  return unranked
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .map((pkg, i) => ({ rank: i + 1, ...pkg }));
}

/**
 * Assembles and persists the 6 CampaignRecommendation rows for a campaign-generation job.
 * Best-effort, same "enhancement, never a hard dependency" posture as the Decision
 * Engine/Company Knowledge Builder steps it runs alongside — a failure here never fails
 * campaign generation, and this never gates or replaces the single Campaign build.
 */
export async function generateAndPersistCampaignRecommendations(
  campaignGenerationJobId: string,
  decisionContext: DecisionContext | null,
  campaignAgentCreatives: AdCreative[],
  landingPageRecommendation: string
): Promise<number> {
  if (!decisionContext || decisionContext.strategies.length === 0) return 0;

  try {
    const packages = assembleCampaignRecommendations({
      strategies: decisionContext.strategies,
      simulations: decisionContext.simulations,
      campaignAgentCreatives,
      landingPageRecommendation,
    });

    // Idempotent re-run safety — a retried/re-triggered job replaces its prior
    // recommendations rather than accumulating duplicates alongside them.
    await prisma.campaignRecommendation.deleteMany({ where: { campaignGenerationJobId } });
    await prisma.campaignRecommendation.createMany({
      data: packages.map((p) => ({
        id: randomUUID(),
        campaignGenerationJobId,
        rank: p.rank,
        objective: p.objective,
        platform: p.platform,
        audience: p.audience,
        dailyBudgetCents: p.dailyBudgetCents,
        campaignStructure: p.campaignStructure as any,
        adSets: p.adSets as any,
        creatives: p.creatives as any,
        headlines: p.headlines as any,
        primaryText: p.primaryText,
        cta: p.cta,
        landingPageRecommendation: p.landingPageRecommendation,
        confidenceScore: p.confidenceScore,
        explanation: p.explanation,
      })),
    });

    return packages.length;
  } catch (err) {
    logger.warn(`Campaign Recommendation Engine failed for campaign generation job ${campaignGenerationJobId} — continuing without persisted recommendations`, err);
    return 0;
  }
}

export async function getCampaignRecommendations(campaignGenerationJobId: string): Promise<CampaignRecommendationPackage[]> {
  const rows = await prisma.campaignRecommendation.findMany({
    where: { campaignGenerationJobId },
    orderBy: { rank: "asc" },
  });
  return rows.map((r) => ({
    rank: r.rank,
    objective: r.objective,
    platform: r.platform,
    audience: r.audience,
    dailyBudgetCents: r.dailyBudgetCents,
    campaignStructure: r.campaignStructure as unknown as { adSetCount: number; structureNotes: string },
    adSets: r.adSets as unknown as { name: string; audience: string }[],
    creatives: r.creatives as unknown as AdCreative[],
    headlines: r.headlines as unknown as string[],
    primaryText: r.primaryText,
    cta: r.cta,
    landingPageRecommendation: r.landingPageRecommendation,
    confidenceScore: r.confidenceScore,
    explanation: r.explanation,
  }));
}
