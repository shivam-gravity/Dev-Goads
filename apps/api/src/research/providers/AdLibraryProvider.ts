import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { AdLibraryData, AdLibraryEntry, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { fetchGoogleTransparencyAdsForQuery, fetchMetaAdsForQuery } from "../ad-intelligence/adSourceClients.js";
import { runProviderStep } from "./support.js";
import { buildSearchQuery } from "./searchQuery.js";

const MOCK_DATA_SOURCE = "mock data — no Meta/Google Ad Library API access configured (dev only)";

// TEMPORARY DEV-ONLY SCAFFOLDING — not a real data source. Local development has no Meta Ad
// Library token and often no working Google Ads Transparency scrape (scraper-service not
// running / Firecrawl not configured), so this provider would always return an empty
// ad-library section locally, making it impossible to visually verify downstream UI/agents
// that consume ResearchContext.adLibrary without live credentials. Gated on an EXPLICIT
// allowlist (`NODE_ENV === "development"`), not the codebase's more common `!== "production"`
// denylist — a denylist would also fire during test runs (NODE_ENV is unset/"test" there),
// which would silently break adSourceClients.test.ts's "zero network calls, empty result"
// assertions. This must never produce data in production. Delete this function (and its call
// site below) once real Meta/Google credentials are available in every dev environment.
function mockAdLibraryEntries(query: string): AdLibraryEntry[] {
  return [
    {
      platform: "meta",
      advertiserName: `${query} (mock competitor)`,
      headline: "Switch and save 20% this month",
      bodyText: "Thousands of businesses trust us to grow faster. See why teams switch — try it free for 14 days.",
      sourceUrl: "https://www.facebook.com/ads/library/?id=0000000000000",
    },
    {
      platform: "meta",
      advertiserName: `${query} Pro (mock competitor)`,
      headline: "The all-in-one platform your team will love",
      bodyText: "Stop juggling five tools. One dashboard, one login, one price. Book a demo today.",
      sourceUrl: "https://www.facebook.com/ads/library/?id=0000000000001",
    },
    {
      platform: "google",
      advertiserName: `${query} Alternative (mock competitor)`,
      headline: "Best-rated alternative — 4.8★ on G2",
      bodyText: "Trusted by 10,000+ companies worldwide. Get started in minutes, no credit card required.",
      sourceUrl: "https://adstransparency.google.com/advertiser/AR00000000000000000",
    },
  ];
}

export class AdLibraryProvider implements ResearchProvider<AdLibraryData> {
  readonly name = "ad-library";
  readonly priority = 213;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<AdLibraryData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = buildSearchQuery(input);

      const [metaResult, googleResult] = await Promise.all([fetchMetaAdsForQuery(query), fetchGoogleTransparencyAdsForQuery(query)]);
      const ads: AdLibraryEntry[] = [...metaResult.ads, ...googleResult.ads].map(({ platform, advertiserName, headline, bodyText, sourceUrl }) => ({
        platform,
        advertiserName,
        headline,
        bodyText,
        sourceUrl,
      }));

      const sources: string[] = [];
      if (metaResult.ads.length > 0) sources.push("Meta Ad Library API (official)");
      if (googleResult.ads.length > 0) {
        const via = googleResult.source === "inhouse" ? "in-house scrape, best-effort" : "Firecrawl scrape, best-effort";
        sources.push(`Google Ads Transparency Center (${via})`);
      }
      if (!process.env.META_AD_LIBRARY_ACCESS_TOKEN) sources.push("Meta source skipped — META_AD_LIBRARY_ACCESS_TOKEN not set");

      // DEV-ONLY: neither real source produced anything (no Meta token, and/or Google's live
      // scrape came back empty) — see mockAdLibraryEntries' comment above for why this exists
      // and why it can never fire outside NODE_ENV=development. Always "partial", never
      // "success" — this is fixture data and must not score as confidently as real grounding.
      if (ads.length === 0 && process.env.NODE_ENV === "development") {
        return { status: "partial", data: { ads: mockAdLibraryEntries(query), dataSource: MOCK_DATA_SOURCE } };
      }

      const data: AdLibraryData = { ads, dataSource: sources.length > 0 ? sources.join("; ") : "No ad library data found for this business" };
      return { status: ads.length > 0 ? "success" : "partial", data };
    });
  }
}
