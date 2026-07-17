import * as cheerio from "cheerio";
import * as llmRouter from "../../infra/llmRouter.js";
import { resolveTaskModel } from "../../infra/llmTaskConfig.js";
import { normalizeUrl, withTimeout } from "../providers/support.js";
import { writeMemory } from "../memory/MemoryCoordinator.js";

/**
 * Landing Page Intelligence — real HTML fetch + parse (same fetch/cheerio pattern as
 * research/providers/SEOProvider.ts), not just a web-search narrative, since a landing
 * page's actual hero copy/CTAs/forms/trust signals are only reliably knowable by reading
 * the page itself. An LLM structured-extraction pass over the cleaned, extracted DOM
 * content then identifies the 8 requested dimensions and recommends improvements.
 */

export interface LandingPageIntelligenceInput {
  url: string;
  businessName?: string;
  workspaceId: string;
  businessId?: string;
}

export interface LandingPageIntelligenceReport {
  url: string;
  hero: string;
  cta: string[];
  trustSignals: string[];
  forms: string[];
  pricing: string;
  socialProof: string[];
  objections: string[];
  seo: { title?: string; description?: string; headingCount: number };
  performanceHints: string[];
  recommendations: string[];
  confidence: number;
  generatedAt: string;
}

const MEMORY_KIND = "landing-page-analysis";
const FETCH_TIMEOUT_MS = 8000;

const LANDING_PAGE_TOOL = {
  name: "emit_landing_page_analysis",
  description: "Analyze a landing page's extracted content and return structured findings plus improvement recommendations.",
  input_schema: {
    type: "object" as const,
    properties: {
      hero: { type: "string", description: "The hero section's core message/value proposition" },
      cta: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "Call-to-action button/link text found" },
      trustSignals: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8, description: "Logos, certifications, security badges, guarantees, awards mentioned" },
      forms: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "Forms present and their apparent purpose (e.g. 'email signup', 'demo request')" },
      pricing: { type: "string", description: "How pricing is presented on this page, or 'Not shown on this page' if absent" },
      socialProof: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "Testimonials, review counts, customer logos, usage stats" },
      objections: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "Objections the page proactively addresses (FAQs, guarantees, comparisons)" },
      recommendations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, description: "Concrete improvements to hero, CTAs, trust signals, forms, or objection-handling" },
    },
    required: ["hero", "cta", "trustSignals", "forms", "pricing", "socialProof", "objections", "recommendations"],
  },
};

type AnalysisFields = Omit<LandingPageIntelligenceReport, "url" | "seo" | "performanceHints" | "confidence" | "generatedAt">;

function fallbackFields(): AnalysisFields {
  return {
    hero: "Unknown — no live research performed.",
    cta: [],
    trustSignals: [],
    forms: [],
    pricing: "Unknown",
    socialProof: [],
    objections: [],
    recommendations: ["Not yet researched"],
  };
}

/** Crude, dependency-free performance signals from the fetched HTML itself — not a real
 * Lighthouse-style audit (no browser, no network waterfall), but genuine signal a
 * heavier tool would also flag: a very large page or a large image count both correlate
 * with slow load times, which directly hurts ad landing-page conversion rate. */
function computePerformanceHints(html: string, imageCount: number): string[] {
  const hints: string[] = [];
  const sizeKb = Buffer.byteLength(html, "utf8") / 1024;
  if (sizeKb > 500) hints.push(`Page HTML is large (${Math.round(sizeKb)}KB) — consider reducing inline scripts/styles for faster load.`);
  if (imageCount > 20) hints.push(`${imageCount} images detected — consider lazy-loading below-the-fold images.`);
  if (hints.length === 0) hints.push("No obvious performance red flags from static HTML alone (this is not a full performance audit).");
  return hints;
}

function computeConfidence(usedFallback: boolean, fetchSucceeded: boolean): number {
  if (usedFallback || !fetchSucceeded) return 0.1;
  return 0.8;
}

async function fetchAndCleanPage(url: string): Promise<{ html: string; text: string; title?: string; description?: string; headingCount: number; imageCount: number }> {
  const normalized = normalizeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const res = await withTimeout(
      fetch(normalized, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; PolluxaResearchBot/1.0)" } }),
      FETCH_TIMEOUT_MS,
      "LandingPageIntelligence fetch"
    );
    if (!res.ok) throw new Error(`Site responded with ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(html);
  const imageCount = $("img").length;
  const title = $("title").first().text().trim() || undefined;
  const description = $('meta[name="description"]').attr("content")?.trim() || $('meta[property="og:description"]').attr("content")?.trim() || undefined;
  const headingCount = $("h1, h2, h3").length;

  $("script, style, noscript, svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);

  return { html, text, title, description, headingCount, imageCount };
}

/**
 * Fetches and parses the real landing page (fetch + cheerio, same pattern as
 * research/providers/SEOProvider.ts), extracts hero/CTA/trust-signal/form/pricing/
 * social-proof/objection content via one LLM structured pass, computes crude static
 * performance hints, and produces concrete recommendations. Persists the analysis to
 * Research Memory via the Memory Coordinator (kind: "landing-page-analysis", dedupKey:
 * the page URL) so re-analyzing the same page later refreshes rather than duplicates.
 */
export async function runLandingPageIntelligence(input: LandingPageIntelligenceInput): Promise<LandingPageIntelligenceReport> {
  let page: Awaited<ReturnType<typeof fetchAndCleanPage>> | null = null;
  try {
    page = await fetchAndCleanPage(input.url);
  } catch {
    page = null;
  }

  if (!page) {
    return {
      url: input.url,
      ...fallbackFields(),
      seo: { headingCount: 0 },
      performanceHints: ["Could not fetch this page — it may be unreachable, blocking automated requests, or JavaScript-rendered content this fetch can't see."],
      confidence: computeConfidence(true, false),
      generatedAt: new Date().toISOString(),
    };
  }

  const performanceHints = computePerformanceHints(page.html, page.imageCount);

  const { data: structured } = await llmRouter.runStructured<AnalysisFields>(resolveTaskModel("landing-page-intelligence"), {
    maxTokens: 1024,
    tool: LANDING_PAGE_TOOL,
    messages: [
      {
        role: "user",
        content: `Analyze this landing page's content for "${input.businessName ?? input.url}" and recommend improvements.\n\nPage title: ${page.title ?? "(none)"}\nMeta description: ${page.description ?? "(none)"}\n\nExtracted page text:\n${page.text}`,
      },
    ],
  });

  const usedFallback = !structured;
  const fields = structured ?? fallbackFields();

  const report: LandingPageIntelligenceReport = {
    url: input.url,
    ...fields,
    seo: { title: page.title, description: page.description, headingCount: page.headingCount },
    performanceHints,
    confidence: computeConfidence(usedFallback, true),
    generatedAt: new Date().toISOString(),
  };

  if (!usedFallback) {
    try {
      await writeMemory({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        kind: MEMORY_KIND,
        sourceUrl: input.url,
        dedupKey: input.url,
        content: `${input.businessName ?? input.url}: ${report.hero} Pricing: ${report.pricing}.`,
        metadata: report as unknown as Record<string, unknown>,
      });
    } catch {
      // Research Memory is an enhancement, never a reason to fail the report.
    }
  }

  return report;
}
