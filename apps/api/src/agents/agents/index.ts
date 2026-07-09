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

/** The full agent set, one instance each — mirrors research/providers/index.ts's
 * createResearchProviders(). CriticAgent is included like any other; callers that want
 * it to review the other 9's outputs pass `{ priorResults }` when invoking it themselves. */
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
    new CriticAgent(),
  ] as AIAgent<unknown>[];
}
