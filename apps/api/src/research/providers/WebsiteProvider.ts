import { scrapeUrl } from "../../modules/onboarding/scraper.js";
import { logger } from "../../modules/logger/logger.js";
import { createCrawlJob, markCrawlJobFailed, persistCrawlPages } from "../crawl/crawlPersistence.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, WebsiteData } from "../types/index.js";
import { runProviderStep } from "./support.js";

const DATA_SOURCE = "Live site crawl (cheerio, multi-page)";

/**
 * Wraps the existing multi-page site crawler (modules/onboarding/scraper.ts, already
 * used by the ResearchSession pipeline) rather than re-implementing crawling — this
 * provider's whole job is adapting that output into the new ProviderResult<WebsiteData>
 * envelope, not duplicating fetch/cheerio logic.
 *
 * When the job carries a businessId, the crawl is also persisted page-by-page
 * (CrawlJob + CrawlPage rows, raw HTML in objectStorage) via crawlPersistence.ts.
 * Persistence is best-effort: a DB/storage failure downgrades to the pre-existing
 * behavior (flattened WebsiteData only) instead of failing the provider, since the
 * research pipeline can still do its job from the in-memory crawl result.
 */
export class WebsiteProvider implements ResearchProvider<WebsiteData> {
  readonly name = "website";
  readonly priority = 10;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<WebsiteData>> {
    return runProviderStep(this.name, 1, input, async () => {
      let crawlJobId: string | undefined;
      if (input.businessId) {
        try {
          crawlJobId = await createCrawlJob({
            businessId: input.businessId,
            workspaceId: input.workspaceId,
            researchJobId: input.jobId,
            url: input.url,
          });
        } catch (err) {
          logger.warn(`WebsiteProvider: couldn't create CrawlJob for ${input.url} — crawling without page-level persistence`, err);
        }
      }

      let site;
      try {
        site = await scrapeUrl(input.url);
      } catch (err) {
        if (crawlJobId) {
          await markCrawlJobFailed(crawlJobId, err instanceof Error ? err.message : String(err)).catch(() => {});
        }
        throw err;
      }

      if (crawlJobId) {
        try {
          await persistCrawlPages(crawlJobId, site);
        } catch (err) {
          logger.warn(`WebsiteProvider: page-level persistence failed for crawl ${crawlJobId} — research continues from the in-memory crawl`, err);
          await markCrawlJobFailed(crawlJobId, err instanceof Error ? err.message : String(err)).catch(() => {});
          crawlJobId = undefined;
        }
      }

      const data: WebsiteData = {
        title: site.title,
        description: site.description,
        excerpt: site.excerpt,
        images: site.images,
        crawledPages: site.crawledPages,
        pagesDiscovered: site.pagesDiscovered,
        screenshot: site.screenshot,
        dataSource: DATA_SOURCE,
        crawlJobId,
      };
      return {
        status: "success",
        data,
        evidence: (site.pages ?? []).map((p) => ({ url: p.url, title: p.title, snippet: p.cleanedText.slice(0, 200) })),
      };
    });
  }
}
