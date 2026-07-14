import { test } from "node:test";
import assert from "node:assert";
import { ProductProvider } from "../research/providers/ProductProvider.js";
import { NavigationProvider } from "../research/providers/NavigationProvider.js";
import { SearchRankingProvider } from "../research/providers/SearchRankingProvider.js";
import { AdLibraryProvider } from "../research/providers/AdLibraryProvider.js";
import { GoogleSerpFeaturesProvider } from "../research/providers/GoogleSerpFeaturesProvider.js";
import { RedditProvider } from "../research/providers/RedditProvider.js";
import { AutocompleteProvider } from "../research/providers/AutocompleteProvider.js";
import type { ResearchProviderInput } from "../research/types/index.js";

delete process.env.FIRECRAWL_API_KEY;
delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
delete process.env.OPENAI_API_KEY;

const INPUT: ResearchProviderInput = { jobId: "job-1", workspaceId: "ws-1", url: "https://example.com", businessName: "Example Co", industry: "widgets" };

// These 6 all gate on FIRECRAWL_API_KEY (checked inside infra/firecrawlClient.ts before any
// fetch) — with it unset, every one must degrade to a labeled partial with zero network calls,
// same "no key -> honest partial, never throw" contract every other provider follows.
const FIRECRAWL_GATED_PROVIDERS = [
  { name: "ProductProvider", instance: new ProductProvider() },
  { name: "NavigationProvider", instance: new NavigationProvider() },
  { name: "SearchRankingProvider", instance: new SearchRankingProvider() },
  { name: "AdLibraryProvider", instance: new AdLibraryProvider() },
  { name: "GoogleSerpFeaturesProvider", instance: new GoogleSerpFeaturesProvider() },
  { name: "RedditProvider", instance: new RedditProvider() },
];

for (const { name, instance } of FIRECRAWL_GATED_PROVIDERS) {
  test(`${name} - degrades to a partial, labeled fallback with zero network calls when FIRECRAWL_API_KEY is unset`, async () => {
    const original = global.fetch;
    let fetchCalled = false;
    global.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    }) as typeof fetch;

    try {
      const result = await instance.execute(INPUT);
      assert.strictEqual(result.status, "partial");
      assert.strictEqual(fetchCalled, false);
      assert.ok(result.data, "expected a labeled fallback data object, not null");
    } finally {
      global.fetch = original;
    }
  });

  test(`${name} - has a unique provider name and a priority above 200`, () => {
    assert.ok(instance.name.length > 0);
    assert.ok(instance.priority > 200, `expected priority > 200 (this batch runs after the original 20), got ${instance.priority}`);
  });
}

test("all 6 Firecrawl-gated providers plus Autocomplete have distinct names", () => {
  const names = [...FIRECRAWL_GATED_PROVIDERS.map((p) => p.instance.name), new AutocompleteProvider().name];
  assert.strictEqual(new Set(names).size, names.length);
});

// AutocompleteProvider has no gating credential at all (Google's suggest endpoint is public,
// unauthenticated) — it always attempts a real fetch, so its "no config" contract is instead
// "a fetch failure degrades to an empty, non-throwing partial result."
test("AutocompleteProvider - a fetch failure degrades to a partial result with no suggestions, never throws", async () => {
  const original = global.fetch;
  global.fetch = (async () => {
    throw new Error("network unavailable");
  }) as typeof fetch;

  try {
    const result = await new AutocompleteProvider().execute(INPUT);
    assert.strictEqual(result.status, "partial");
    assert.deepStrictEqual(result.data?.suggestions, []);
  } finally {
    global.fetch = original;
  }
});
