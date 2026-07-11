import { logger } from "../modules/logger/logger.js";
import { runCreativeIntelligence } from "./creative-intelligence/CreativeIntelligenceEngine.js";
import { runPricingIntelligence } from "./pricing-intelligence/PricingIntelligenceEngine.js";
import { runLandingPageIntelligence } from "./landing-page-intelligence/LandingPageIntelligenceEngine.js";
import type { ResearchContext } from "./types/index.js";

/**
 * Runs the 3 Intelligence Engines that were built and tested but never invoked outside
 * their own test files — Creative, Pricing, and Landing-Page Intelligence
 * (research/{creative,pricing,landing-page}-intelligence/*.ts) — as a best-effort,
 * fire-and-forget enrichment pass after the research phase completes.
 *
 * Their primary value here isn't their return value (nothing currently reads it) — it's
 * the Research Memory entries they write as a side effect ("creative-analysis" and
 * "pricing-analysis" kinds). Before this, explainRecommendations
 * (research/decision/explainability.ts) queried those exact memory kinds for every
 * creative/messaging/offer recommendation and always got zero matches, because nothing
 * anywhere ever wrote to them — a permanently-dead lookup, not a rare miss. This makes
 * that lookup live: not necessarily for the run that triggered it (this is fire-and-forget,
 * racing the Decision Engine's own explainability pass), but for every subsequent run on
 * this or a similar business.
 *
 * Creative/Pricing Intelligence both require a competitor list as input (they analyze
 * competitors' creative/pricing, they don't discover competitors themselves) — sourced
 * from this same ResearchContext's own `competitors` field, so no extra research call is
 * needed to get it. Landing-Page Intelligence needs no competitor context and always runs.
 * Never throws: a failure here is explicitly not allowed to affect campaign generation,
 * which doesn't depend on any of this.
 */
export async function runIntelligenceEnrichment(context: ResearchContext): Promise<void> {
  const competitors = (context.competitors?.competitors ?? []).map((c) => ({ name: c.name, url: c.url }));

  const base = { url: context.url, businessName: context.company?.name, workspaceId: context.workspaceId, businessId: context.businessId };

  await Promise.all([
    runLandingPageIntelligence(base).catch((err) => {
      logger.warn(`Landing Page Intelligence enrichment failed for ${context.url} — continuing without it`, err);
    }),
    competitors.length > 0
      ? runCreativeIntelligence({ ...base, competitors }).catch((err) => {
          logger.warn(`Creative Intelligence enrichment failed for ${context.url} — continuing without it`, err);
        })
      : Promise.resolve(),
    competitors.length > 0
      ? runPricingIntelligence({ ...base, competitors }).catch((err) => {
          logger.warn(`Pricing Intelligence enrichment failed for ${context.url} — continuing without it`, err);
        })
      : Promise.resolve(),
  ]);
}
