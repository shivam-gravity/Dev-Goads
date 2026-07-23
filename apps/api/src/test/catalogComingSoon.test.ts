import { test } from "node:test";
import assert from "node:assert";
import {
  ACTIVE_CATALOG_SOURCES,
  isCatalogSourceEnabled,
  CATALOG_COMING_SOON_MESSAGE,
} from "../config/platforms.js";

// The MVP is scoped to Meta + Google ad delivery only; every store/catalog sync source is deferred
// ("coming soon"). These lock in the backend guardrail the catalog + Shopify-OAuth routes gate on,
// so a source can't be silently re-enabled without also updating this expectation.

test("catalog guardrail - no catalog source is enabled in the MVP", () => {
  assert.strictEqual(ACTIVE_CATALOG_SOURCES.length, 0, "expected zero active catalog sources");
});

test("catalog guardrail - isCatalogSourceEnabled is false for every store/catalog source", () => {
  for (const source of ["shopify", "woocommerce", "facebook", "google"]) {
    assert.strictEqual(isCatalogSourceEnabled(source), false, `${source} must be deferred`);
  }
});

test("catalog guardrail - a user-facing coming-soon message is defined", () => {
  assert.match(CATALOG_COMING_SOON_MESSAGE, /coming soon/i);
});
