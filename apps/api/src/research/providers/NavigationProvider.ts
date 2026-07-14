import { outageDataSource } from "../../infra/firecrawlClient.js";
import { mapUrlWithFallback, sourceLabel } from "../../infra/scrapeFallback.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { NavigationData, NavigationPage, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { normalizeUrl, runProviderStep } from "./support.js";

const MAX_PAGES = 40;

/** Best-effort page classification from the URL path — same categories as
 * modules/onboarding/scraper.ts's derivePageType, kept as a separate small function here since
 * this provider classifies Firecrawl's map results, not scraper.ts's crawl results. */
function classifyPage(pageUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return "other";
  }
  if (pathname === "/" || pathname === "") return "homepage";
  if (/\bpricing\b/i.test(pathname)) return "pricing";
  if (/\babout\b/i.test(pathname)) return "about";
  if (/\bfeatures?\b/i.test(pathname)) return "features";
  if (/\b(product|products|shop|store|collections?)\b/i.test(pathname)) return "product";
  return "other";
}

/** Deterministic, no-LLM pass-through of Firecrawl's `/map` page discovery — this is the
 * "Navigation crawler": it shows what pages exist on a site and how they're classified, not
 * reasoning about them. Cheapest provider in the whole suite (1 Firecrawl credit). */
export class NavigationProvider implements ResearchProvider<NavigationData> {
  readonly name = "navigation";
  readonly priority = 211;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<NavigationData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const url = normalizeUrl(input.url);
      const mapped = await mapUrlWithFallback(url, { limit: MAX_PAGES });
      if (mapped.outage) {
        return { status: "partial", data: { pages: [], totalDiscovered: 0, dataSource: outageDataSource(mapped.outage) } };
      }

      const pages: NavigationPage[] = mapped.links.slice(0, MAX_PAGES).map((link) => ({
        url: link.url,
        title: link.title,
        pageType: classifyPage(link.url),
        discovered: true,
      }));

      const data: NavigationData = {
        pages,
        totalDiscovered: mapped.links.length,
        dataSource: sourceLabel(mapped.source, "site map (sitemap + link discovery)"),
      };
      return { status: pages.length > 0 ? "success" : "partial", data };
    });
  }
}
