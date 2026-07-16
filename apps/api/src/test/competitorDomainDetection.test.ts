import { test } from "node:test";
import assert from "node:assert";
import { domainMismatchesName, isUntrustworthyUrl, coreName } from "../scripts/competitorDomainDetection.js";

// domainMismatchesName decides whether a stored competitor.domain gets CLEARED. Once Bucket B
// (real homepage resolution) lands, this runs against genuine competitor domains — a false
// positive here would wipe a real homepage, a false negative would keep a citation host. Both
// directions are locked down below.

test("domainMismatchesName - flags citation hosts (the real 07-14 stale domains from the audit)", () => {
  // Every one of these is an actual (name, domain) pair pulled from the stale relational rows.
  const flagged: [string, string][] = [
    ["PayPal", "businesschronicler.com"],
    ["Helcim", "forbes.com"],
    ["Adyen", "champsignal.com"],
    ["Salesforce", "softwarepodium.com"],
    ["Pipedrive", "g2.com"],
    ["HubSpot Sales Hub", "gartner.com"],
    ["Authorize.Net", "businesschronicler.com"],
    ["Sarcos Robotics", "growjo.com"],
  ];
  for (const [name, host] of flagged) {
    assert.strictEqual(domainMismatchesName(name, host), true, `expected "${name}" / ${host} to be flagged as a citation host`);
  }
});

test("domainMismatchesName - keeps a domain that genuinely matches the brand (the Bucket-B happy path)", () => {
  const kept: [string, string][] = [
    ["Stripe", "stripe.com"],
    ["PayPal", "paypal.com"],
    ["Adyen", "adyen.com"],
    ["HubSpot", "hubspot.com"],
    ["Salesforce", "salesforce.com"],
    ["Stripe", "stripe.com.au"], // brand token present on a ccTLD variant
  ];
  for (const [name, host] of kept) {
    assert.strictEqual(domainMismatchesName(name, host), false, `expected "${name}" / ${host} to be KEPT (brand token present)`);
  }
});

test("domainMismatchesName - multi-word name matches on any single significant token", () => {
  // "Microsoft Dynamics 365 Sales" -> a domain owning any >=4-char word is a real match.
  assert.strictEqual(domainMismatchesName("Microsoft Dynamics 365 Sales", "dynamics.microsoft.com"), false);
  assert.strictEqual(domainMismatchesName("Microsoft Dynamics 365 Sales", "microsoft.com"), false);
  // …but a citation host owning none of its tokens is still flagged.
  assert.strictEqual(domainMismatchesName("Microsoft Dynamics 365 Sales", "gartner.com"), true);
});

test("domainMismatchesName - short names still match via the flattened form", () => {
  // "Poal.me" -> core "poal me" -> flat "poalme"; each word is <4 chars so the word loop can't
  // match, but the flat token (>=4) can when the domain genuinely belongs to the brand.
  assert.strictEqual(domainMismatchesName("Poal.me", "poalme.io"), false, "flat-match path should keep a real brand domain");
  assert.strictEqual(domainMismatchesName("Poal.me", "alternativeto.net"), true, "a citation host is still flagged for a short name");
});

test("domainMismatchesName - empty/blank host is treated as a mismatch (nothing to trust)", () => {
  assert.strictEqual(domainMismatchesName("Stripe", ""), true);
  assert.strictEqual(domainMismatchesName("Stripe", "   "), true);
});

test("coreName - strips corporate suffixes, parentheticals, and punctuation", () => {
  // "holdings" and "inc" are both corporate suffixes -> both stripped.
  assert.strictEqual(coreName("PayPal Holdings, Inc."), "paypal");
  assert.strictEqual(coreName("Authorize.Net"), "authorize net");
  assert.strictEqual(coreName("Acme (EMEA) Corp."), "acme");
});

test("isUntrustworthyUrl - full-url rule flags citation articles and non-root paths, keeps a real homepage", () => {
  // Wrong host -> flagged regardless of path.
  assert.strictEqual(isUntrustworthyUrl("PayPal", "https://businesschronicler.com/paypal-competitors"), true);
  // Right host but a deep article path -> flagged (a homepage is essentially always a root path).
  assert.strictEqual(isUntrustworthyUrl("Airtable", "https://airtable.com/articles/some-post"), true);
  // Right host + root path -> the genuine homepage, kept.
  assert.strictEqual(isUntrustworthyUrl("Stripe", "https://stripe.com/"), false);
  assert.strictEqual(isUntrustworthyUrl("Stripe", "https://www.stripe.com"), false);
  // Unparseable -> flagged.
  assert.strictEqual(isUntrustworthyUrl("Stripe", "not-a-url"), true);
});
