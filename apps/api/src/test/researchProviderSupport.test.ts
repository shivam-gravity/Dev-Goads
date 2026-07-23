import { test } from "node:test";
import assert from "node:assert";
import { FACT_GROUNDED_CAP, FACT_GROUNDED_FLOOR, factGroundingScore, isRelevantCitation, sanitizeBusinessName } from "../research/providers/support.js";
import { buildSearchQuery } from "../research/providers/searchQuery.js";

function facts(n: number, confidence = 0.9, sources = n): { field: string; value: string; sourceUrl?: string; confidence: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    field: `f${i}`,
    value: `v${i}`,
    sourceUrl: i < sources ? `https://site.com/p${i}` : undefined,
    confidence,
  }));
}

test("factGroundingScore - empty facts return the bare floor (nominal grounding only)", () => {
  assert.strictEqual(factGroundingScore([]), FACT_GROUNDED_FLOOR);
});

test("factGroundingScore - a rich, high-confidence, multi-source fact base scores above the flat floor", () => {
  const score = factGroundingScore(facts(12, 0.95, 4));
  assert.ok(score > FACT_GROUNDED_FLOOR, `expected > ${FACT_GROUNDED_FLOOR}, got ${score}`);
  assert.ok(score <= FACT_GROUNDED_CAP, `must never exceed the cap ${FACT_GROUNDED_CAP}, got ${score}`);
});

test("factGroundingScore - a richer/higher-confidence fact base outscores a thin one (monotonic in quality)", () => {
  const thin = factGroundingScore(facts(2, 0.6, 1));
  const rich = factGroundingScore(facts(12, 0.95, 4));
  assert.ok(rich > thin, `rich (${rich}) must beat thin (${thin})`);
  assert.ok(thin >= FACT_GROUNDED_FLOOR, `even a thin fact base stays at/above the floor, got ${thin}`);
});

test("factGroundingScore - never exceeds the cap even with a huge fact dump", () => {
  assert.ok(factGroundingScore(facts(500, 1, 50)) <= FACT_GROUNDED_CAP);
});

test("isRelevantCitation - multi-word businessName matches via a significant word, not just the full phrase", () => {
  const target = { url: "https://polluxa.com", businessName: "Polluxa Demo Business" };
  const citation = { url: "https://linkedin.com/company/polluxa", title: "Polluxa | LinkedIn" };

  assert.strictEqual(isRelevantCitation(citation, target), true);
});

test("isRelevantCitation - a title matching only filler words from the businessName is NOT relevant", () => {
  const target = { url: "https://polluxa.com", businessName: "Polluxa Demo Business" };
  const citation = { url: "https://example.com/demo-companies", title: "Top Demo Companies of 2026" };

  assert.strictEqual(isRelevantCitation(citation, target), false);
});

test("sanitizeBusinessName - strips placeholder/seed and legal-suffix tokens, keeping the distinctive part", () => {
  assert.strictEqual(sanitizeBusinessName("Polluxa Demo Business"), "Polluxa");
  assert.strictEqual(sanitizeBusinessName("Acme Inc."), "Acme");
  assert.strictEqual(sanitizeBusinessName("The Widget Company"), "Widget");
  assert.strictEqual(sanitizeBusinessName("Demo Business"), "", "an all-filler name leaves nothing distinctive");
});

const baseInput = (businessName?: string) => ({ jobId: "j", workspaceId: "w", businessId: "b", url: "https://www.polluxa.com/crm", businessName });

test("buildSearchQuery - anchors on the sanitized business name (a 'Demo Business' fixture no longer poisons the query)", () => {
  assert.strictEqual(buildSearchQuery(baseInput("Polluxa Demo Business")), `"Polluxa"`);
});

test("buildSearchQuery - falls back to the domain when the name is all filler or absent", () => {
  assert.strictEqual(buildSearchQuery(baseInput("Demo Business")), `"polluxa.com"`, "all-filler name -> domain anchor");
  assert.strictEqual(buildSearchQuery(baseInput(undefined)), `"polluxa.com"`, "no name -> domain anchor (www stripped)");
});
