import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import { WebsiteProvider } from "./WebsiteProvider.js";
import { SearchProvider } from "./SearchProvider.js";
import { TechnologyProvider } from "./TechnologyProvider.js";
import { CompanyProvider } from "./CompanyProvider.js";
import { MarketProvider } from "./MarketProvider.js";
import { MarketIntelligenceProvider } from "./MarketIntelligenceProvider.js";
import { CompetitorProvider } from "./CompetitorProvider.js";
import { CompetitorIntelligenceProvider } from "./CompetitorIntelligenceProvider.js";
import { AudienceProvider } from "./AudienceProvider.js";
import { AudienceIntelligenceProvider } from "./AudienceIntelligenceProvider.js";
import { SEOProvider } from "./SEOProvider.js";
import { NewsProvider } from "./NewsProvider.js";
import { SocialMediaProvider } from "./SocialMediaProvider.js";
import { ReviewsProvider } from "./ReviewsProvider.js";
import { FundingProvider } from "./FundingProvider.js";
import { HiringSignalsProvider } from "./HiringSignalsProvider.js";
import { ContentMarketingProvider } from "./ContentMarketingProvider.js";
import { BacklinkAuthorityProvider } from "./BacklinkAuthorityProvider.js";
import { AppStoreProvider } from "./AppStoreProvider.js";
import { VideoPresenceProvider } from "./VideoPresenceProvider.js";
import { LocalPresenceProvider } from "./LocalPresenceProvider.js";
import { PartnershipProvider } from "./PartnershipProvider.js";
import { LegalRegulatoryProvider } from "./LegalRegulatoryProvider.js";
import { ProductProvider } from "./ProductProvider.js";
import { NavigationProvider } from "./NavigationProvider.js";
import { SearchRankingProvider } from "./SearchRankingProvider.js";
import { AdLibraryProvider } from "./AdLibraryProvider.js";
import { AutocompleteProvider } from "./AutocompleteProvider.js";
import { GoogleSerpFeaturesProvider } from "./GoogleSerpFeaturesProvider.js";
import { RedditProvider } from "./RedditProvider.js";

export { WebsiteProvider } from "./WebsiteProvider.js";
export { SearchProvider } from "./SearchProvider.js";
export { TechnologyProvider } from "./TechnologyProvider.js";
export { CompanyProvider } from "./CompanyProvider.js";
export { MarketProvider } from "./MarketProvider.js";
export { MarketIntelligenceProvider } from "./MarketIntelligenceProvider.js";
export { CompetitorProvider } from "./CompetitorProvider.js";
export { CompetitorIntelligenceProvider } from "./CompetitorIntelligenceProvider.js";
export { AudienceProvider } from "./AudienceProvider.js";
export { AudienceIntelligenceProvider } from "./AudienceIntelligenceProvider.js";
export { SEOProvider } from "./SEOProvider.js";
export { NewsProvider } from "./NewsProvider.js";
export { SocialMediaProvider } from "./SocialMediaProvider.js";
export { ReviewsProvider } from "./ReviewsProvider.js";
export { FundingProvider } from "./FundingProvider.js";
export { HiringSignalsProvider } from "./HiringSignalsProvider.js";
export { ContentMarketingProvider } from "./ContentMarketingProvider.js";
export { BacklinkAuthorityProvider } from "./BacklinkAuthorityProvider.js";
export { AppStoreProvider } from "./AppStoreProvider.js";
export { VideoPresenceProvider } from "./VideoPresenceProvider.js";
export { LocalPresenceProvider } from "./LocalPresenceProvider.js";
export { PartnershipProvider } from "./PartnershipProvider.js";
export { LegalRegulatoryProvider } from "./LegalRegulatoryProvider.js";
export { ProductProvider } from "./ProductProvider.js";
export { NavigationProvider } from "./NavigationProvider.js";
export { SearchRankingProvider } from "./SearchRankingProvider.js";
export { AdLibraryProvider } from "./AdLibraryProvider.js";
export { AutocompleteProvider } from "./AutocompleteProvider.js";
export { GoogleSerpFeaturesProvider } from "./GoogleSerpFeaturesProvider.js";
export { RedditProvider } from "./RedditProvider.js";

/**
 * The full provider set the orchestrator runs, in one place — adding/removing a
 * research dimension means editing this array only, since every provider is
 * independently executable (see ResearchProvider's doc comment). Order here is
 * cosmetic (matches `priority`); the orchestrator always fans these out in parallel.
 *
 * CompetitorIntelligenceProvider (3-source discovery + per-competitor enrichment +
 * Knowledge Fusion drift detection) replaces the older, single-search CompetitorProvider
 * here — same "competitor" name/slot/CompetitorData shape, strictly deeper research
 * underneath. CompetitorProvider itself is kept (exported above, still covered by its
 * own tests) as a lighter-weight reference implementation, not deleted.
 *
 * The 11 providers below NewsProvider are new (Social Media, Reviews, Funding, Hiring
 * Signals, Content Marketing, Backlink Authority, App Store, Video Presence, Local
 * Presence, Partnerships, Legal/Regulatory) — each an independent, live-search-grounded
 * research dimension feeding its own optional ResearchContext field (see
 * research/types/index.ts), following the exact same webSearchThenStructure pattern as
 * every original provider.
 *
 * The 7 providers below LegalRegulatoryProvider are the crawler batch (Product, Navigation,
 * Search-ranking, Ad Library, Autocomplete, Google SERP features, Reddit). Their scrape/map/
 * crawl needs go through infra/scrapeFallback.ts, which runs the in-house Playwright scraper
 * (scraper-service) and the self-hosted crawl4ai service concurrently and merges the results —
 * no metered vendor, no credit budget (Firecrawl was removed). WebsiteProvider, ReviewsProvider,
 * and SocialMediaProvider (above) draw on the same crawl layer.
 */
export function createResearchProviders(): ResearchProvider<unknown>[] {
  return [
    new WebsiteProvider(),
    new SearchProvider(),
    new CompanyProvider(),
    new MarketIntelligenceProvider(),
    new CompetitorIntelligenceProvider(),
    new AudienceIntelligenceProvider(),
    new TechnologyProvider(),
    new SEOProvider(),
    new NewsProvider(),
    new SocialMediaProvider(),
    new ReviewsProvider(),
    new FundingProvider(),
    new HiringSignalsProvider(),
    new ContentMarketingProvider(),
    new BacklinkAuthorityProvider(),
    new AppStoreProvider(),
    new VideoPresenceProvider(),
    new LocalPresenceProvider(),
    new PartnershipProvider(),
    new LegalRegulatoryProvider(),
    new ProductProvider(),
    new NavigationProvider(),
    new SearchRankingProvider(),
    new AdLibraryProvider(),
    new AutocompleteProvider(),
    new GoogleSerpFeaturesProvider(),
    new RedditProvider(),
  ] as ResearchProvider<unknown>[];
}
