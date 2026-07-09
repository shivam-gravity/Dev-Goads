import { CompetitorProvider } from "../../research/providers/CompetitorProvider.js";
import { NewsProvider } from "../../research/providers/NewsProvider.js";
import { TechnologyProvider } from "../../research/providers/TechnologyProvider.js";
import { NO_CITATIONS_DATA_SOURCE, NO_SEARCH_DATA_SOURCE } from "../../research/providers/support.js";
import type { CompetitorData, ProviderResult, ResearchProviderInput, TechnologyData } from "../../research/types/index.js";
import { combineChecks, minConfidence, nonEmptyArray, usedRealData } from "../checks.js";
import type { EvalCase } from "../types.js";

const KNOWN_FALLBACKS = [NO_SEARCH_DATA_SOURCE, NO_CITATIONS_DATA_SOURCE];

function input(url: string, businessName?: string): ResearchProviderInput {
  return { jobId: "eval", workspaceId: "eval", url, businessName };
}

/**
 * Deliberately small (5 cases) — every case is a REAL provider call (real web search /
 * real fetch), so this suite costs real API spend and wall-clock time to run; it's meant
 * to be run deliberately (`npm run eval:research`) before/after a provider prompt change,
 * not on every commit. Covers both the happy path (a well-known company should surface
 * real, citable data) and the degradation path (a nonsense domain should still return a
 * usable, honestly-labeled fallback rather than an error) — a suite that only tested the
 * happy path would miss a regression in the fallback logic itself.
 */
export const researchProviderEvalCases: EvalCase<ProviderResult<unknown>>[] = [
  {
    name: "competitor-provider / stripe.com finds real, named competitors",
    run: () => new CompetitorProvider().execute(input("https://stripe.com", "Stripe")),
    check: (result) => {
      const data = result.data as CompetitorData | null;
      return combineChecks(
        nonEmptyArray(data?.competitors, "competitors", 2),
        usedRealData(data?.dataSource, KNOWN_FALLBACKS),
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "news-provider / stripe.com finds recent, citable coverage",
    run: () => new NewsProvider().execute(input("https://stripe.com", "Stripe")),
    check: (result) => {
      if (result.status === "failed") return { pass: false, score: 0, notes: `provider failed: ${result.error}` };
      // News coverage existing at all is a weaker guarantee than named competitors (a
      // quiet news month is plausible for any real company), so this only requires the
      // provider to have attempted a real search, not that it necessarily found articles.
      return combineChecks(usedRealData((result.data as { dataSource?: string } | null)?.dataSource, KNOWN_FALLBACKS));
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "technology-provider / stripe.com detects real signals from live headers+markup",
    run: () => new TechnologyProvider().execute(input("https://stripe.com")),
    check: (result) => {
      const data = result.data as TechnologyData | null;
      const detectedSomething = Boolean(data?.cms || data?.hostingProvider || data?.frameworks.length || data?.analyticsTools.length);
      return { pass: detectedSomething, score: detectedSomething ? 1 : 0, notes: `detectedFrom: ${JSON.stringify(data?.detectedFrom)}` };
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "competitor-provider / a nonsense domain degrades to a labeled, low-confidence fallback rather than an error",
    run: () => new CompetitorProvider().execute(input("https://this-domain-should-not-plausibly-exist-adgo-eval.test")),
    check: (result) => {
      // The point of this case: it must NOT be "failed" (a made-up domain should never
      // crash the pipeline), and confidence must honestly reflect that no real data was
      // found — a regression here (e.g. confidence staying high on a fallback) would be
      // exactly the kind of "AI Insights that quietly aren't grounded" bug this whole
      // confidence system exists to catch.
      const notFailed = result.status !== "failed";
      const honestlyLowConfidence = result.confidence <= 0.5;
      return {
        pass: notFailed && honestlyLowConfidence,
        score: notFailed && honestlyLowConfidence ? 1 : 0,
        notes: `status=${result.status} confidence=${result.confidence}`,
      };
    },
    confidence: (r) => r.confidence,
  },
];
