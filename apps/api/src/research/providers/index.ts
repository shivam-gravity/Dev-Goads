import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import { WebsiteProvider } from "./WebsiteProvider.js";
import { SearchProvider } from "./SearchProvider.js";
import { TechnologyProvider } from "./TechnologyProvider.js";
import { CompanyProvider } from "./CompanyProvider.js";
import { MarketProvider } from "./MarketProvider.js";
import { CompetitorProvider } from "./CompetitorProvider.js";
import { AudienceProvider } from "./AudienceProvider.js";
import { SEOProvider } from "./SEOProvider.js";
import { NewsProvider } from "./NewsProvider.js";

export { WebsiteProvider } from "./WebsiteProvider.js";
export { SearchProvider } from "./SearchProvider.js";
export { TechnologyProvider } from "./TechnologyProvider.js";
export { CompanyProvider } from "./CompanyProvider.js";
export { MarketProvider } from "./MarketProvider.js";
export { CompetitorProvider } from "./CompetitorProvider.js";
export { AudienceProvider } from "./AudienceProvider.js";
export { SEOProvider } from "./SEOProvider.js";
export { NewsProvider } from "./NewsProvider.js";

/**
 * The full provider set the orchestrator runs, in one place — adding/removing a
 * research dimension means editing this array only, since every provider is
 * independently executable (see ResearchProvider's doc comment). Order here is
 * cosmetic (matches `priority`); the orchestrator always fans these out in parallel.
 */
export function createResearchProviders(): ResearchProvider<unknown>[] {
  return [
    new WebsiteProvider(),
    new SearchProvider(),
    new CompanyProvider(),
    new MarketProvider(),
    new CompetitorProvider(),
    new AudienceProvider(),
    new TechnologyProvider(),
    new SEOProvider(),
    new NewsProvider(),
  ] as ResearchProvider<unknown>[];
}
