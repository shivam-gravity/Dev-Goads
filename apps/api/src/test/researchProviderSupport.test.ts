import { test } from "node:test";
import assert from "node:assert";
import { isRelevantCitation, sanitizeBusinessName } from "../research/providers/support.js";
import { buildSearchQuery } from "../research/providers/searchQuery.js";

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
