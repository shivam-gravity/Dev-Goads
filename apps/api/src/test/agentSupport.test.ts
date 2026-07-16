import { test } from "node:test";
import assert from "node:assert";
import { computeConfidence, collectEvidence, isPlaceholderTerm, filterPlaceholderTerms } from "../agents/support.js";
import type { ResearchContext } from "../research/types/index.js";

function fixtureContext(overrides: Partial<ResearchContext> = {}): ResearchContext {
  return {
    jobId: "job-1",
    workspaceId: "ws-1",
    url: "https://example.com",
    website: { title: "t", description: "d", excerpt: "e", images: [], crawledPages: [], pagesDiscovered: 1, dataSource: "crawl" },
    market: null,
    technology: null,
    competitors: null,
    keywords: null,
    audience: null,
    company: null,
    news: null,
    metadata: { jobId: "job-1", generatedAt: "now", totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
    ...overrides,
  };
}

test("computeConfidence - forces the fallback floor whenever usedFallback is true, regardless of data completeness", () => {
  const context = fixtureContext({ company: { name: "n", summary: "s", dataSource: "d" } });
  assert.strictEqual(computeConfidence(context, ["website", "company"], true), 0.2);
});

test("computeConfidence - is penalized per missing field and floors at 0.2", () => {
  const context = fixtureContext();
  const withOneMissing = computeConfidence(context, ["website", "market"], false); // market is null
  const withAllPresent = computeConfidence(context, ["website"], false);
  assert.ok(withOneMissing < withAllPresent, "a missing dependency should score lower than none missing");
  assert.ok(withAllPresent <= 0.95 && withAllPresent > 0);

  const allMissing = computeConfidence(context, ["market", "technology", "competitors", "keywords", "audience", "company", "news"], false);
  assert.strictEqual(allMissing, 0.2, "score should floor at 0.2, never go negative");
});

test("collectEvidence - pulls each field's dataSource label when present", () => {
  const context = fixtureContext();
  const evidence = collectEvidence(context, ["website", "market"]);
  assert.deepStrictEqual(evidence, [
    { source: "website", detail: "crawl" },
    { source: "market", detail: "market was not available in this ResearchContext" },
  ]);
});

test("filterPlaceholderTerms - drops all four degraded-output sentinel families", () => {
  assert.deepStrictEqual(
    filterPlaceholderTerms([
      "Not yet researched",
      "Insufficient research data to build named personas.",
      "Unknown — no live research performed",
      "Not available.",
    ]),
    []
  );
});

test("filterPlaceholderTerms - keeps legitimate interest terms / keywords untouched", () => {
  const real = ["GDPR", "AI-native CRM", "product lifecycle management"];
  assert.deepStrictEqual(filterPlaceholderTerms(real), real);
});

test("filterPlaceholderTerms - is case-insensitive", () => {
  assert.deepStrictEqual(filterPlaceholderTerms(["NOT YET RESEARCHED", "GDPR"]), ["GDPR"]);
});

test("filterPlaceholderTerms - drops empty, whitespace-only, and non-string entries", () => {
  assert.deepStrictEqual(
    filterPlaceholderTerms(["", "   ", "GDPR", null as unknown as string, undefined as unknown as string, 42 as unknown as string]),
    ["GDPR"]
  );
});

test("filterPlaceholderTerms - an all-placeholder list collapses to [] so the caller omits the field", () => {
  const out = filterPlaceholderTerms(["Not yet researched", "Unknown — no live research performed"]);
  assert.strictEqual(out.length, 0); // metaInterests.length ? {…} : {} -> field omitted
});

test("isPlaceholderTerm - tightened matching does NOT collide with real keywords that share a sentinel prefix", () => {
  // Real ad keywords legitimately start with these words — must survive the filter.
  for (const real of ["unknowable behavior", "unknown caller id", "unknown number lookup", "insufficient funds fee", "insufficient milk supply", "not available in stores"]) {
    assert.strictEqual(isPlaceholderTerm(real), false, `expected "${real}" to be kept`);
  }
  // The actual sentinels are still caught.
  for (const junk of ["Not yet researched", "Unknown", "Unknown — no live research performed", "Insufficient market research to score this opportunity confidently.", "Not available."]) {
    assert.strictEqual(isPlaceholderTerm(junk), true, `expected "${junk}" to be dropped`);
  }
});
