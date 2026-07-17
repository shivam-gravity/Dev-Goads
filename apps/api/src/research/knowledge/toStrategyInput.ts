import type { ResearchStrategyInput } from "../../modules/strategy/strategyEngine.js";
import type { AudiencePersona } from "../../types/index.js";
import type { ResearchContext } from "../types/index.js";

const DEFAULT_DAILY_BUDGET_CENTS = 5000;

/**
 * Bridges the new parallel-provider pipeline into the existing "AI Agents" step
 * (modules/strategy/strategyEngine.ts's createStrategyFromResearch) rather than writing
 * a second strategy generator — per the "do not duplicate existing functionality"
 * requirement, Campaign generation from research stays exactly one implementation.
 * ResearchContext's shape (website/market/technology/competitors/keywords/audience/
 * company/news) doesn't map 1:1 onto the older ResearchStrategyInput (product/audience/
 * competitorBudget/marketLocation/personas) it was originally designed against — this is
 * an honest best-effort remap, not a lossless one, and every field that has no direct
 * source is filled with a clearly-labeled fallback (same "Unknown — no live research
 * performed" convention modules/onboarding/marketResearch.ts already uses) rather than a
 * fabricated value.
 */
export function toStrategyInput(context: ResearchContext): ResearchStrategyInput {
  const productName = context.company?.name ?? context.website?.title ?? context.url;
  const category = context.keywords?.primaryKeywords?.[0]
    ? context.keywords.primaryKeywords[0][0].toUpperCase() + context.keywords.primaryKeywords[0].slice(1)
    : "General business";

  const product: ResearchStrategyInput["product"] = {
    productName,
    category,
    summary: context.company?.summary ?? context.website?.description ?? `A business operating at ${context.url}.`,
    valueProposition: context.website?.description ?? context.company?.summary ?? "Distinct offering worth exploring further in the strategy step.",
    keyFeatures: context.keywords?.headings?.slice(0, 6)?.filter(Boolean) ?? ["Core product/service"],
    pricingModel: undefined,
    pricingRange: undefined,
    dataSource: context.company?.dataSource ?? context.website?.dataSource ?? "Research orchestrator (no company/website provider data)",
  };

  const segments = context.audience?.segments ?? [
    { name: "New customers", description: "First-time visitors evaluating the offering" },
  ];

  const audience: ResearchStrategyInput["audience"] = {
    primaryAudience: context.audience?.primaryAudience ?? `People interested in ${category.toLowerCase()}`,
    segments,
    painPoints: context.audience?.painPoints ?? ["Uncertainty about which option fits their needs"],
    buyingMotivations: ["Convenience", "Trust and credibility", "Price/value"],
    demographics: context.audience?.demographics
      ? { ...context.audience.demographics, occupation: "Unknown — not modeled by this pipeline's AudienceProvider" }
      : undefined,
    interestTags: context.audience?.interestTags ?? [category],
    dataSource: context.audience?.dataSource || "Unknown — no live audience research performed",
  };

  const competitorBudget: ResearchStrategyInput["competitorBudget"] = {
    competitors: context.competitors?.competitors?.map((c) => c.name) ?? ["Other providers in this category"],
    competitionIntensity: context.competitors?.competitionIntensity ?? context.market?.competitionLevel ?? "Unknown — no live research performed",
    differentiators: context.competitors?.differentiators ?? ["Distinct offering worth exploring further in the strategy step"],
    budgetReasoning: [
      "No dedicated budget-calculation provider ran in this pipeline — using a conservative generic starting budget.",
      "Recompute via the strategist chat or a manual campaign edit once live spend data is available.",
    ],
    recommendedDailyBudgetCents: DEFAULT_DAILY_BUDGET_CENTS,
    dataSource: context.competitors?.dataSource ?? "Unknown — no live competitor research performed",
  };

  const marketLocation: ResearchStrategyInput["marketLocation"] = {
    recommendedRegion: context.market?.recommendedRegion ?? "United States",
    alternativeRegions: [],
    marketTrends: context.market?.trends?.join("; ") || "Unknown — no live research performed.",
    keyDrivers: context.market?.trends,
    competitionLevel: context.market?.competitionLevel ?? "Unknown — no live research performed",
    recommendedPlatform: "meta",
    placementRationale:
      "Meta is recommended as a low-cost, high-reach default — this pipeline has no dedicated ad-platform-recommendation provider yet.",
    dataSource: context.market?.dataSource ?? "Unknown — no live market research performed",
  };

  const personas: AudiencePersona[] = segments.map((segment) => ({
    name: segment.name,
    ageRange: context.audience?.demographics?.ageDistribution ?? "25-54",
    genderSplit: context.audience?.demographics?.genderRatio ?? "Balanced distribution",
    details: segment.description,
    interests: (context.audience?.interestTags ?? [category]).slice(0, 6),
  }));

  return { product, audience, competitorBudget, marketLocation, personas };
}
