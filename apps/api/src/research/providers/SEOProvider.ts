import * as cheerio from "cheerio";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchProviderInput, SEOData } from "../types/index.js";
import { normalizeUrl, runProviderStep, withTimeout } from "./support.js";

const FETCH_TIMEOUT_MS = 8000;
const MAX_KEYWORDS = 12;
const DATA_SOURCE = "On-page meta tags + keyword-frequency analysis (single page)";

// Common English stopwords + a few markup/boilerplate terms that would otherwise
// dominate frequency counts on almost any page.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "be", "been", "being", "this", "that", "these", "those", "it", "its", "as", "at", "by", "from", "we", "you",
  "your", "our", "us", "they", "their", "them", "he", "she", "his", "her", "i", "not", "have", "has", "had",
  "will", "would", "can", "could", "about", "into", "more", "all", "if", "do", "does", "so", "than", "then",
  "up", "out", "no", "yes", "how", "what", "when", "where", "who", "which", "also", "get", "using",
]);

function extractKeywords(bodyText: string): string[] {
  const counts = new Map<string, number>();
  const words = bodyText.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYWORDS)
    .map(([word]) => word);
}

/**
 * On-page SEO signal extraction (meta title/description, headings, top keywords by
 * frequency) — its own single-page fetch, independent of WebsiteProvider's multi-page
 * crawl and every other provider. No OpenAI dependency: keyword extraction is a plain
 * frequency heuristic, so this provider works identically with or without an API key.
 */
export class SEOProvider implements ResearchProvider<SEOData> {
  readonly name = "seo";
  readonly priority = 80;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<SEOData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const url = normalizeUrl(input.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let html: string;
      try {
        const res = await withTimeout(
          fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AdGoResearchBot/1.0)" } }),
          FETCH_TIMEOUT_MS,
          "SEOProvider fetch"
        );
        if (!res.ok) throw new Error(`Site responded with ${res.status}`);
        html = await res.text();
      } finally {
        clearTimeout(timer);
      }

      const $ = cheerio.load(html);
      $("script, style, noscript, svg, nav, footer").remove();

      const metaTitle = $("title").first().text().trim() || undefined;
      const metaDescription =
        $('meta[name="description"]').attr("content")?.trim() || $('meta[property="og:description"]').attr("content")?.trim() || undefined;
      const headings = $("h1, h2")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean)
        .slice(0, 15);
      const bodyText = $("body").text().replace(/\s+/g, " ").trim();

      const data: SEOData = {
        primaryKeywords: extractKeywords(bodyText),
        metaTitle,
        metaDescription,
        headings,
        dataSource: DATA_SOURCE,
      };

      return { status: data.primaryKeywords.length > 0 ? "success" : "partial", data };
    });
  }
}
