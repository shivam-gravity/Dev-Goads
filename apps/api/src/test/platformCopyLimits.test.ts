import { test } from "node:test";
import assert from "node:assert";
import { PLATFORM_COPY_LIMITS, truncateForPlatform, applyCopyLimitsForNetwork, applyGoogleRsaLimits, GOOGLE_RSA_LIMITS } from "../modules/strategy/platformCopyLimits.js";
import type { AdCreative } from "../types/index.js";

test("PLATFORM_COPY_LIMITS - each network has its own real, distinct limits (not one shared constant)", () => {
  assert.deepStrictEqual(PLATFORM_COPY_LIMITS.meta, { headline: 40, body: 125 });
  assert.deepStrictEqual(PLATFORM_COPY_LIMITS.google, { headline: 30, body: 90 });
  assert.deepStrictEqual(PLATFORM_COPY_LIMITS.tiktok, { headline: 100, body: 100 });
});

test("truncateForPlatform - text within the limit is returned unchanged", () => {
  assert.strictEqual(truncateForPlatform("Short headline", 40), "Short headline");
});

test("truncateForPlatform - text over the limit is truncated with an ellipsis, never exceeding max", () => {
  const long = "This headline is definitely far too long for any ad network's real limit";
  const result = truncateForPlatform(long, 30);
  assert.ok(result.length <= 30, `expected length <= 30, got ${result.length}`);
  assert.ok(result.endsWith("…"));
});

test("truncateForPlatform - trims surrounding whitespace before measuring length", () => {
  assert.strictEqual(truncateForPlatform("  Padded  ", 40), "Padded");
});

test("applyCopyLimitsForNetwork - a single creative gets independently truncated per network, without mutating the input", () => {
  const creative: AdCreative = {
    headline: "A headline that is much longer than thirty characters for sure",
    body: "A body of ad copy that runs well past ninety characters, definitely exceeding Google's description limit for a single asset.",
    callToAction: "Learn More",
  };

  const meta = applyCopyLimitsForNetwork(creative, "meta");
  const google = applyCopyLimitsForNetwork(creative, "google");
  const tiktok = applyCopyLimitsForNetwork(creative, "tiktok");

  assert.ok(meta.headline.length <= 40);
  assert.ok(google.headline.length <= 30);
  assert.ok(tiktok.headline.length <= 100);
  // Google's real limit is stricter than Meta's, so truncating the same source headline for
  // each network must not produce identical output — that's the exact bug this fixes.
  assert.notStrictEqual(meta.headline, google.headline);

  assert.ok(meta.body.length <= 125);
  assert.ok(google.body.length <= 90);
  assert.ok(tiktok.body.length <= 100);

  // Original creative object must be untouched — the same shared creative is reused across
  // multiple networks (see campaignOrchestrator.buildCampaignFromStrategy's cross-product).
  assert.strictEqual(creative.headline, "A headline that is much longer than thirty characters for sure");
});

test("applyCopyLimitsForNetwork - short copy that already fits every network's limit is untouched everywhere", () => {
  const creative: AdCreative = { headline: "Fast widgets", body: "Get widgets fast.", callToAction: "Shop Now" };
  for (const network of ["meta", "google", "tiktok"] as const) {
    const result = applyCopyLimitsForNetwork(creative, network);
    assert.strictEqual(result.headline, "Fast widgets");
    assert.strictEqual(result.body, "Get widgets fast.");
  }
});

test("applyGoogleRsaLimits - truncates every headline to ≤30 and every description to ≤90, de-duped", () => {
  const creative: AdCreative = {
    headline: "First headline",
    body: "First description body copy that is comfortably under ninety characters in length.",
    callToAction: "Shop Now",
    headlines: [
      "This headline is way beyond the thirty character limit for RSA assets",
      "Short one",
      "Short one", // duplicate → collapses
      "Another distinct headline here",
    ],
    descriptions: [
      "This RSA description is deliberately written to run well past Google's ninety-character per-asset description limit so truncation is exercised.",
      "A short second description.",
    ],
  };

  const result = applyGoogleRsaLimits(creative);

  assert.ok(result.headlines && result.headlines.length > 0);
  for (const h of result.headlines!) {
    assert.ok(h.length <= GOOGLE_RSA_LIMITS.headlineMaxChars, `headline "${h}" (${h.length}) must be ≤30`);
  }
  for (const d of result.descriptions!) {
    assert.ok(d.length <= GOOGLE_RSA_LIMITS.descriptionMaxChars, `description "${d}" (${d.length}) must be ≤90`);
  }
  assert.strictEqual(new Set(result.headlines).size, result.headlines!.length, "headlines must be de-duped");
  assert.ok(result.headlines!.length <= GOOGLE_RSA_LIMITS.maxHeadlines);
  assert.ok(result.descriptions!.length <= GOOGLE_RSA_LIMITS.maxDescriptions);
});

test("applyGoogleRsaLimits - falls back to the singular headline/body when no arrays are supplied", () => {
  const creative: AdCreative = { headline: "Only headline", body: "Only body copy.", callToAction: "Go" };
  const result = applyGoogleRsaLimits(creative);
  assert.deepStrictEqual(result.headlines, ["Only headline"]);
  assert.deepStrictEqual(result.descriptions, ["Only body copy."]);
});

test("applyCopyLimitsForNetwork - google now validates the full RSA asset set (headlines + descriptions arrays)", () => {
  const creative: AdCreative = {
    headline: "H",
    body: "B",
    callToAction: "CTA",
    headlines: ["A headline that exceeds the thirty-character Google RSA limit for sure", "H2", "H3", "H4", "H5"],
    descriptions: ["D1", "D2", "D3", "D4"],
  };
  const google = applyCopyLimitsForNetwork(creative, "google");
  assert.strictEqual(google.headlines?.length, 5, "all 5 distinct headlines are carried");
  assert.strictEqual(google.descriptions?.length, 4, "all 4 distinct descriptions are carried");
  for (const h of google.headlines!) assert.ok(h.length <= 30);
  for (const d of google.descriptions!) assert.ok(d.length <= 90);
});
