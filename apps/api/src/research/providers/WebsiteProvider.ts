import { normalizeUrl } from "../../modules/onboarding/scraper.js";
import { crawl4aiScrape } from "../../infra/crawl4aiClient.js";
import { outageDataSource } from "../../infra/scrapeTypes.js";
import { crawlUrlWithFallback, scrapeUrlWithFallback, sourceLabel } from "../../infra/scrapeFallback.js";
import { refineContent } from "../../infra/contentRefiner.js";
import { logger } from "../../modules/logger/logger.js";
import { createCrawlJob, markCrawlJobFailed, persistCrawlPages } from "../crawl/crawlPersistence.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, WebsiteData } from "../types/index.js";
import { runProviderStep } from "./support.js";
import type { ScrapedPage, ScrapedSite } from "../../types/index.js";

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
 * Tries an in-house crawl first (reusing onboarding/scraper.ts's scrapeUrl — sitemap+link
 * discovery, robots.txt compliance, a Playwright screenshot — with its own crawlCap/
 * timeBudgetMs so this feature's tuning stays independent of onboarding's), falling
 * through to Firecrawl's `/crawl` only when the in-house attempt fails or looks blocked.
 * See scrapeFallback.ts's crawlUrlWithFallback for the fallback logic itself. Keeps this
 * provider's own output shape and CrawlJob/CrawlPage persistence exactly as before either
 * way, so nothing downstream needs to change based on which backend served the crawl.
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

      let crawled = await crawlUrlWithFallback(url, { limit: CRAWL_PAGE_LIMIT, formats: ["markdown", "links"] });
      if (crawled.outage) {
        if (crawlJobId) await markCrawlJobFailed(crawlJobId, outageDataSource(crawled.outage)).catch(() => {});
        const outageData: WebsiteData = { title: "", description: "", excerpt: "", images: [], crawledPages: [], pagesDiscovered: 0, dataSource: outageDataSource(crawled.outage), crawlJobId };
        return { status: "partial", data: outageData };
      }
      // The multi-page deep crawl is more fragile than a single-page scrape (crawl4ai can flake on
      // the deep-crawl path under load). Rather than hard-fail a CORE provider to zero confidence
      // when we can plainly reach the site, fall back to a single-page scrape of the entry URL —
      // the exact path the up-front prefetch uses successfully. One real page beats a total miss.
      if (crawled.pages.length === 0) {
        const single = await scrapeUrlWithFallback(url, ["markdown", "links"]);
        const md = single.data?.markdown?.trim();
        if (md) {
          crawled = {
            pages: [{ markdown: md, html: single.data?.html ?? "", links: single.data?.links ?? [], metadata: { title: single.data?.metadata?.title, sourceURL: url } }],
            outage: null,
            source: single.source,
          };
        } else {
          if (crawlJobId) await markCrawlJobFailed(crawlJobId, "Crawl returned no pages").catch(() => {});
          throw new Error("Couldn't crawl that URL — no pages were returned");
        }
      }

      // When the in-house crawl contributed (source "inhouse" or "merged"), it already
      // captured a screenshot and a deduped image list of its own (via scrapeUrl's internal
      // captureScreenshot/extractImages) — reuse those. When only crawl4ai served the crawl,
      // do a dedicated crawl4ai screenshot scrape and derive images from the page links.
      let screenshot: string | undefined;
      let images: string[];
      if (crawled.source === "inhouse" || crawled.source === "merged") {
        screenshot = crawled.screenshot;
        images = crawled.images ?? [];
      } else {
        const screenshotResult = await crawl4aiScrape(url, ["screenshot"]);
        screenshot = screenshotResult.outage ? undefined : (screenshotResult.data?.screenshot ?? undefined);
        images = (crawled.pages[0].links ?? []).filter((link) => /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(link)).slice(0, 8);
      }

      const entryUrl = crawled.pages[0].metadata?.sourceURL ?? url;
      const pages: ScrapedPage[] = crawled.pages.map((page, index) => {
        const pageUrl = page.metadata?.sourceURL ?? entryUrl;
        return {
          url: pageUrl,
          title: page.metadata?.title || pageUrl,
          pageType: classifyPage(pageUrl, index === 0),
          relevanceScore: index === 0 ? 1 : 0.5,
          // Refine the raw crawl markdown before persisting: crawl4ai's markdown carries inline
          // CSS/JS (SPAs ship critical CSS like nprogress in the shell) and nav/footer boilerplate.
          // extractCrawlFacts reads this cleanedText straight from the DB, so storing raw markdown
          // fed the fact-extractor CSS noise → ~0 facts → un-grounded providers/agents and low
          // research confidence. refineContent strips that deterministically (relevanceFilter off:
          // this is the business's own site, keep all real prose). Falls back to the raw slice if
          // refinement somehow empties it, so a page never persists blank.
          cleanedText: (refineContent(page.markdown ?? "", "", { maxChars: MAX_EXCERPT_LENGTH, relevanceFilter: false }) || (page.markdown ?? "")).slice(0, MAX_EXCERPT_LENGTH),
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
        dataSource: sourceLabel(crawled.source, "multi-page crawl"),
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
