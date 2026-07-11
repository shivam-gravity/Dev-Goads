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
export function createAIAgents(): AIAgent<unknown>[] {
  return [
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
}
