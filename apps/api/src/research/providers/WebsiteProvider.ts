import { normalizeUrl } from "../../modules/onboarding/scraper.js";
import { firecrawlCrawl, firecrawlScrape, outageDataSource } from "../../infra/firecrawlClient.js";
import { logger } from "../../modules/logger/logger.js";
import { createCrawlJob, markCrawlJobFailed, persistCrawlPages } from "../crawl/crawlPersistence.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, WebsiteData } from "../types/index.js";
import { runProviderStep } from "./support.js";
import type { ScrapedPage, ScrapedSite } from "../../types/index.js";

const DATA_SOURCE = "Firecrawl multi-page crawl";
const CRAWL_PAGE_LIMIT = 15;
const MAX_EXCERPT_LENGTH = 6000;

/** Best-effort page classification from the URL path — same categories NavigationProvider uses
 * for Firecrawl's `/map` results; kept as its own small copy here rather than a shared import
 * since each provider that needs it fetches/classifies independently (ResearchProvider's
 * "no cross-provider dependency" contract). */
function classifyPage(pageUrl: string, isEntry: boolean): string {
  if (isEntry) return "homepage";
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return "other";
  }
  if (/\bpricing\b/i.test(pathname)) return "pricing";
  if (/\babout\b/i.test(pathname)) return "about";
  if (/\bfeatures?\b/i.test(pathname)) return "features";
  if (/\b(product|products|shop|store|collections?)\b/i.test(pathname)) return "product";
  return "other";
}

/**
 * Firecrawl-backed rewrite — was a hand-rolled cheerio crawl (modules/onboarding/scraper.ts),
 * now delegates the actual fetching/rendering to Firecrawl's `/crawl` (sitemap+link discovery,
 * JS rendering, proxy/anti-bot handling) while keeping this provider's own output shape and
 * CrawlJob/CrawlPage persistence exactly as before, so nothing downstream needs to change.
 * `scraper.ts` itself is untouched — its 7 other callers (onboarding analysis, SEOProvider,
 * competitor-intelligence enrichment, etc.) keep working exactly as today.
 */
export class WebsiteProvider implements ResearchProvider<WebsiteData> {
  readonly name = "website";
  readonly priority = 10;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<WebsiteData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const url = normalizeUrl(input.url);

      let crawlJobId: string | undefined;
      if (input.businessId) {
        try {
          crawlJobId = await createCrawlJob({ businessId: input.businessId, workspaceId: input.workspaceId, researchJobId: input.jobId, url });
        } catch (err) {
          logger.warn(`WebsiteProvider: couldn't create CrawlJob for ${input.url} — crawling without page-level persistence`, err);
        }
      }

      const crawled = await firecrawlCrawl(url, { limit: CRAWL_PAGE_LIMIT, formats: ["markdown", "links"] });
      if (crawled.outage) {
        if (crawlJobId) await markCrawlJobFailed(crawlJobId, outageDataSource(crawled.outage)).catch(() => {});
        const outageData: WebsiteData = { title: "", description: "", excerpt: "", images: [], crawledPages: [], pagesDiscovered: 0, dataSource: outageDataSource(crawled.outage), crawlJobId };
        return { status: "partial", data: outageData };
      }
      if (crawled.pages.length === 0) {
        if (crawlJobId) await markCrawlJobFailed(crawlJobId, "Firecrawl crawl returned no pages").catch(() => {});
        throw new Error("Couldn't crawl that URL — Firecrawl returned no pages");
      }

      const screenshotResult = await firecrawlScrape(url, ["screenshot"]);
      const screenshot = screenshotResult.outage ? undefined : (screenshotResult.data?.screenshot ?? undefined);

      const entryUrl = crawled.pages[0].metadata?.sourceURL ?? url;
      const images = (crawled.pages[0].links ?? []).filter((link) => /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(link)).slice(0, 8);
      const pages: ScrapedPage[] = crawled.pages.map((page, index) => {
        const pageUrl = page.metadata?.sourceURL ?? entryUrl;
        return {
          url: pageUrl,
          title: page.metadata?.title || pageUrl,
          pageType: classifyPage(pageUrl, index === 0),
          relevanceScore: index === 0 ? 1 : 0.5,
          cleanedText: (page.markdown ?? "").slice(0, MAX_EXCERPT_LENGTH),
          html: page.html ?? "",
        };
      });

      const site: ScrapedSite = {
        url: entryUrl,
        title: pages[0]?.title || entryUrl,
        description: crawled.pages[0].metadata?.description ?? "",
        excerpt: pages.map((p) => p.cleanedText).join("\n").slice(0, MAX_EXCERPT_LENGTH * CRAWL_PAGE_LIMIT),
        images,
        crawledPages: pages.map((p) => p.url),
        pagesDiscovered: pages.length,
        screenshot,
        pages,
      };

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
        evidence: pages.map((p) => ({ url: p.url, title: p.title, snippet: p.cleanedText.slice(0, 200) })),
      };
    });
  }
}
