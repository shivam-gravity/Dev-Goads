import { test } from "node:test";
import assert from "node:assert";
import { isRelevantCitation } from "../research/providers/support.js";

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
