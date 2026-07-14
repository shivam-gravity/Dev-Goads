import { firecrawlMap, firecrawlScrape, outageDataSource } from "../../infra/firecrawlClient.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProductData, ProductEntry, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { normalizeUrl, runProviderStep } from "./support.js";

const PRODUCT_PAGE_HINTS = /\b(product|products|shop|store|pricing|plans|collections?)\b/i;
const MAX_PRODUCT_PAGES = 4;

/** Real product/pricing extraction — Firecrawl's `product` scrape format is deterministic
 * (JSON-LD + schema.org + embedded state, no LLM call), so this provider has no OpenAI
 * dependency at all, unlike most others. Independent of every other provider: it re-discovers
 * candidate pages itself via `firecrawlMap` rather than reusing WebsiteProvider's crawl, per
 * ResearchProvider's "never depend on another provider's result" contract. */
export class ProductProvider implements ResearchProvider<ProductData> {
  readonly name = "product";
  readonly priority = 210;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<ProductData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const url = normalizeUrl(input.url);
      const mapped = await firecrawlMap(url, { limit: 50 });
      if (mapped.outage) {
        return { status: "partial", data: { products: [], dataSource: outageDataSource(mapped.outage) } };
      }

      const candidatePages = mapped.links.filter((link) => PRODUCT_PAGE_HINTS.test(link.url)).slice(0, MAX_PRODUCT_PAGES);
      const pagesToScrape = candidatePages.length > 0 ? candidatePages : [{ url }];

      const products: ProductEntry[] = [];
      for (const page of pagesToScrape) {
        const scraped = await firecrawlScrape(page.url, [{ type: "product" }]);
        if (scraped.outage) break;
        const p = scraped.data?.product;
        if (!p) continue;
        for (const variant of p.variants ?? []) {
          products.push({
            name: variant.title || p.title || "Untitled product",
            priceText: variant.price?.formatted ?? (variant.price?.amount != null ? `${variant.price.amount} ${variant.price.currency ?? ""}`.trim() : undefined),
            features: p.description ? [p.description] : [],
            availability: variant.availability?.text,
          });
        }
        if (!p.variants?.length && (p.title || p.description)) {
          products.push({ name: p.title ?? "Untitled product", features: p.description ? [p.description] : [] });
        }
      }

      const dataSource =
        products.length > 0
          ? `Firecrawl product extraction (${candidatePages.length > 0 ? "pricing/product pages" : "homepage"})`
          : "Firecrawl found no structured product/pricing data on this site";

      return { status: products.length > 0 ? "success" : "partial", data: { products, dataSource } };
    });
  }
}
