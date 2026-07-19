import "../prompts/definitions/index.js";
import { ProductAgent } from "./ProductAgent.js";
import { AudienceAgent } from "./AudienceAgent.js";
import { CompetitorAgent } from "./CompetitorAgent.js";
import { MarketAgent } from "./MarketAgent.js";
import { KeywordAgent } from "./KeywordAgent.js";
import { CreativeAgent } from "./CreativeAgent.js";
import { BudgetAgent } from "./BudgetAgent.js";
import { PersonaAgent } from "./PersonaAgent.js";
import { CampaignAgent } from "./CampaignAgent.js";
import { CriticAgent } from "./CriticAgent.js";
import { LandingPageAgent } from "./LandingPageAgent.js";
import { PricingOfferAgent } from "./PricingOfferAgent.js";
import { LocalizationAgent } from "./LocalizationAgent.js";
import { SEOContentAgent } from "./SEOContentAgent.js";
import { SeasonalityTimingAgent } from "./SeasonalityTimingAgent.js";
import { ChannelPlacementAgent } from "./ChannelPlacementAgent.js";
import { FunnelRetargetingAgent } from "./FunnelRetargetingAgent.js";
import { ObjectionHandlingAgent } from "./ObjectionHandlingAgent.js";
import { ForecastingKPIAgent } from "./ForecastingKPIAgent.js";
import { ComplianceAgent } from "./ComplianceAgent.js";
import type { AIAgent } from "../interfaces/AIAgent.js";

export { ProductAgent } from "./ProductAgent.js";
export { AudienceAgent } from "./AudienceAgent.js";
export { CompetitorAgent } from "./CompetitorAgent.js";
export { MarketAgent } from "./MarketAgent.js";
export { KeywordAgent } from "./KeywordAgent.js";
export { CreativeAgent } from "./CreativeAgent.js";
export { BudgetAgent } from "./BudgetAgent.js";
export { PersonaAgent } from "./PersonaAgent.js";
export { CampaignAgent } from "./CampaignAgent.js";
export { CriticAgent } from "./CriticAgent.js";
export { LandingPageAgent } from "./LandingPageAgent.js";
export { PricingOfferAgent } from "./PricingOfferAgent.js";
export { LocalizationAgent } from "./LocalizationAgent.js";
export { SEOContentAgent } from "./SEOContentAgent.js";
export { SeasonalityTimingAgent } from "./SeasonalityTimingAgent.js";
export { ChannelPlacementAgent } from "./ChannelPlacementAgent.js";
export { FunnelRetargetingAgent } from "./FunnelRetargetingAgent.js";
export { ObjectionHandlingAgent } from "./ObjectionHandlingAgent.js";
export { ForecastingKPIAgent } from "./ForecastingKPIAgent.js";
export { ComplianceAgent } from "./ComplianceAgent.js";

/** The full agent set, one instance each — mirrors research/providers/index.ts's
 * createResearchProviders(). CriticAgent and ComplianceAgent are the 2 reviewer agents;
 * AgentCoordinator runs them last with `{ priorResults }` so they can review the other
 * 18 producers' outputs (see AgentCoordinator.ts's REVIEWER_AGENT_NAMES). */
/**
 * The lean agent set used when META_ADS_ESSENTIAL_ONLY is on (the default). These are exactly
 * the agents whose output the campaign-build step actually READS (see the
 * `pipeline.results["…-agent"]` reads in campaignGenerationPipeline.ts) — no agent runs whose
 * result is then thrown away. The other 10 agents (product/competitor/market/channel-placement/
 * funnel-retargeting/forecasting-kpi/landing-page/localization/seo-content/seasonality-timing)
 * are dropped: their analysis is subsumed by the campaign-agent, which synthesizes the full
 * strategy (positioning, channel mix, funnel, targeting) directly from the research context —
 * one relevant agent doing what several narrow ones did. Fewer agents = fewer Gemini calls =
 * stays under the free-tier per-minute limit and finishes fast. The 2 reviewers (critic,
 * compliance) are kept — they gate ad quality/policy. Set META_ADS_ESSENTIAL_ONLY=false for the
 * full 20-agent set.
 */
// 7 essential agents. persona-agent was MERGED into audience-agent (its v2 prompt already builds
// personas; the audience-agent now emits them and the pipeline derives the persona result from
// that output) — one agent doing two jobs, one fewer LLM call against the free-tier rate limit.
const META_ESSENTIAL_AGENTS = new Set<string>([
  "campaign-agent", // REQUIRED: synthesizes the whole strategy (absorbs product/market/competitor/channel/funnel/pricing/objections)
  "creative-agent", // ad headlines + body copy (covers offer + objection framing)
  "audience-agent", // audience profile + interest targeting + PERSONAS (merged persona-agent's job)
  "keyword-agent", // Meta interest-keyword validation
  "budget-agent", // daily budget from CPC/competition
  "critic-agent", // quality review (reviewer)
  "compliance-agent", // Meta/Google policy review (reviewer)
]);

const META_ADS_ESSENTIAL_ONLY = process.env.META_ADS_ESSENTIAL_ONLY !== "false";

export function createAIAgents(): AIAgent<unknown>[] {
  const all = [
    new ProductAgent(),
    new AudienceAgent(),
    new CompetitorAgent(),
    new MarketAgent(),
    new KeywordAgent(),
    new CreativeAgent(),
    new BudgetAgent(),
    new PersonaAgent(),
    new CampaignAgent(),
    new LandingPageAgent(),
    new PricingOfferAgent(),
    new LocalizationAgent(),
    new SEOContentAgent(),
    new SeasonalityTimingAgent(),
    new ChannelPlacementAgent(),
    new FunnelRetargetingAgent(),
    new ObjectionHandlingAgent(),
    new ForecastingKPIAgent(),
    new CriticAgent(),
    new ComplianceAgent(),
  ] as AIAgent<unknown>[];

  if (!META_ADS_ESSENTIAL_ONLY) return all;
  return all.filter((a) => META_ESSENTIAL_AGENTS.has(a.name));
}
