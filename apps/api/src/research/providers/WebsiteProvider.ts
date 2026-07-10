import { scrapeUrl } from "../../modules/onboarding/scraper.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, WebsiteData } from "../types/index.js";
import { runProviderStep } from "./support.js";

const DATA_SOURCE = "Live site crawl (cheerio, multi-page)";

/**
 * Wraps the existing multi-page site crawler (modules/onboarding/scraper.ts, already
 * used by the ResearchSession pipeline) rather than re-implementing crawling — this
 * provider's whole job is adapting that output into the new ProviderResult<WebsiteData>
 * envelope, not duplicating fetch/cheerio logic.
 */
export class WebsiteProvider implements ResearchProvider<WebsiteData> {
  readonly name = "website";
  readonly priority = 10;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<WebsiteData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const site = await scrapeUrl(input.url);
      const data: WebsiteData = {
        title: site.title,
        description: site.description,
        excerpt: site.excerpt,
        images: site.images,
        crawledPages: site.crawledPages,
        pagesDiscovered: site.pagesDiscovered,
        screenshot: site.screenshot,
        dataSource: DATA_SOURCE,
      };
      return { status: "success", data };
    });
  }
}
