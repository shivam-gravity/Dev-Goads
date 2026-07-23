import { test } from "node:test";
import assert from "node:assert";
import { refineContent } from "../infra/contentRefiner.js";

const PROMPT = "Research the pricing and product features of Acme enterprise software";

test("refineContent - strips nav/boilerplate lines, keeping real content", () => {
  const raw = [
    "Home",
    "Menu",
    "![logo](https://x.com/logo.png)",
    "Acme offers three pricing tiers for enterprise software.",
    "© 2026 Acme Inc. All rights reserved.",
    "Cookie consent: we use cookies.",
  ].join("\n");

  const out = refineContent(raw, PROMPT);
  assert.match(out, /three pricing tiers/, "real content is kept");
  assert.doesNotMatch(out, /Home|Menu|logo\.png|rights reserved|Cookie consent/i, "boilerplate is stripped");
});

test("refineContent - reduces markdown links to their visible text (drops the URL to save tokens)", () => {
  const raw = "See the [Acme pricing page](https://acme.com/pricing) for enterprise software details.";
  const out = refineContent(raw, PROMPT);
  assert.match(out, /Acme pricing page/, "link text is kept");
  assert.doesNotMatch(out, /https:\/\/acme\.com/, "the URL itself is dropped");
});

test("refineContent - keeps query-relevant lines and drops unrelated ones (relevance filter)", () => {
  const raw = [
    "Acme software includes SSO, audit logs, and pricing tiers.", // relevant (keywords)
    "Our office cafeteria serves great coffee on Tuesdays.", // irrelevant, short
  ].join("\n");

  const out = refineContent(raw, PROMPT);
  assert.match(out, /SSO, audit logs/);
  assert.doesNotMatch(out, /cafeteria/, "short unrelated line is dropped under relevance filter");
});

test("refineContent - a long prose sentence is kept even without an exact keyword hit", () => {
  const longLine =
    "The platform was founded to help mid-market organizations consolidate their operational tooling into a single connected system, reducing vendor sprawl and total cost of ownership over time.";
  const out = refineContent(longLine, PROMPT);
  assert.match(out, /consolidate their operational tooling/, "substantial prose survives even without keyword match");
});

test("refineContent - respects maxChars cap (the token-budget guard)", () => {
  const raw = Array.from({ length: 200 }, (_, i) => `Acme pricing feature line number ${i} with enterprise software detail.`).join("\n");
  const out = refineContent(raw, PROMPT, { maxChars: 300 });
  assert.ok(out.length <= 300, `expected <= 300 chars, got ${out.length}`);
});

test("refineContent - collapses duplicate lines (repeated nav/CTAs across a page)", () => {
  const raw = [
    "Acme enterprise software pricing details here.",
    "Acme enterprise software pricing details here.",
    "Acme enterprise software pricing details here.",
  ].join("\n");
  const out = refineContent(raw, PROMPT);
  assert.strictEqual(out.split("\n").length, 1, "duplicate lines collapse to one");
});

test("refineContent - empty input yields empty output, never throws", () => {
  assert.strictEqual(refineContent("", PROMPT), "");
});

test("refineContent - relevanceFilter:false keeps prose but still strips boilerplate", () => {
  const raw = ["Menu", "Some unrelated but real paragraph about weather patterns in general."].join("\n");
  const out = refineContent(raw, PROMPT, { relevanceFilter: false });
  assert.doesNotMatch(out, /^Menu$/m, "boilerplate still stripped");
  assert.match(out, /weather patterns/, "non-matching prose kept when relevance filter is off");
});
