import { test } from "node:test";
import assert from "node:assert";
import { PLATFORM_COPY_LIMITS, truncateForPlatform, applyCopyLimitsForNetwork } from "../modules/strategy/platformCopyLimits.js";
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
