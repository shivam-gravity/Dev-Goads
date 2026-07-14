import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { AdLibraryData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { fetchGoogleTransparencyAdsForQuery, fetchMetaAdsForQuery } from "../ad-intelligence/adSourceClients.js";
import { hostnameOf, runProviderStep } from "./support.js";

export class AdLibraryProvider implements ResearchProvider<AdLibraryData> {
  readonly name = "ad-library";
  readonly priority = 213;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<AdLibraryData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const query = input.businessName ?? hostnameOf(input.url).replace(/^www\./i, "").split(".")[0];

      const [metaResult, googleResult] = await Promise.all([fetchMetaAdsForQuery(query), fetchGoogleTransparencyAdsForQuery(query)]);
      const ads = [...metaResult.ads, ...googleResult.ads].map(({ platform, advertiserName, headline, bodyText, sourceUrl }) => ({
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

      const data: AdLibraryData = { ads, dataSource: sources.length > 0 ? sources.join("; ") : "No ad library data found for this business" };
      return { status: ads.length > 0 ? "success" : "partial", data };
    });
  }
}
