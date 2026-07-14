import { test } from "node:test";
import assert from "node:assert";
import { AppStoreProvider } from "../research/providers/AppStoreProvider.js";
import { BacklinkAuthorityProvider } from "../research/providers/BacklinkAuthorityProvider.js";
import { ContentMarketingProvider } from "../research/providers/ContentMarketingProvider.js";
import { FundingProvider } from "../research/providers/FundingProvider.js";
import { HiringSignalsProvider } from "../research/providers/HiringSignalsProvider.js";
import { LegalRegulatoryProvider } from "../research/providers/LegalRegulatoryProvider.js";
import { LocalPresenceProvider } from "../research/providers/LocalPresenceProvider.js";
import { PartnershipProvider } from "../research/providers/PartnershipProvider.js";
import { ReviewsProvider } from "../research/providers/ReviewsProvider.js";
import { SocialMediaProvider } from "../research/providers/SocialMediaProvider.js";
import { VideoPresenceProvider } from "../research/providers/VideoPresenceProvider.js";
import type { ResearchProviderInput } from "../research/types/index.js";

delete process.env.OPENAI_API_KEY;
// ReviewsProvider/SocialMediaProvider now try a real Firecrawl crawl before falling back to the
// LLM-web-search path tested below — unset so the "zero network calls" assertion still holds.
delete process.env.FIRECRAWL_API_KEY;

const INPUT: ResearchProviderInput = { jobId: "job-1", workspaceId: "ws-1", url: "https://example.com", businessName: "Example Co", industry: "widgets" };

const PROVIDERS = [
  { name: "SocialMediaProvider", instance: new SocialMediaProvider() },
  { name: "ReviewsProvider", instance: new ReviewsProvider() },
  { name: "FundingProvider", instance: new FundingProvider() },
  { name: "HiringSignalsProvider", instance: new HiringSignalsProvider() },
  { name: "ContentMarketingProvider", instance: new ContentMarketingProvider() },
  { name: "BacklinkAuthorityProvider", instance: new BacklinkAuthorityProvider() },
  { name: "AppStoreProvider", instance: new AppStoreProvider() },
  { name: "VideoPresenceProvider", instance: new VideoPresenceProvider() },
  { name: "LocalPresenceProvider", instance: new LocalPresenceProvider() },
  { name: "PartnershipProvider", instance: new PartnershipProvider() },
  { name: "LegalRegulatoryProvider", instance: new LegalRegulatoryProvider() },
];

for (const { name, instance } of PROVIDERS) {
  test(`${name} - degrades to a partial, labeled fallback with zero network calls when OPENAI_API_KEY is unset`, async () => {
    const original = global.fetch;
    let fetchCalled = false;
    global.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    }) as typeof fetch;

    try {
      const result = await instance.execute(INPUT);
      assert.strictEqual(result.status, "partial");
      assert.strictEqual(result.citations.length, 0);
      assert.strictEqual(fetchCalled, false);
      assert.ok(result.data, "expected a labeled fallback data object, not null");
    } finally {
      global.fetch = original;
    }
  });

  test(`${name} - has a unique provider name and a priority in [100, 200]`, () => {
    assert.ok(instance.name.length > 0);
    assert.ok(instance.priority >= 100 && instance.priority <= 200, `expected priority in [100,200], got ${instance.priority}`);
  });
}

test("all 11 new providers have distinct names", () => {
  const names = PROVIDERS.map((p) => p.instance.name);
  assert.strictEqual(new Set(names).size, names.length);
});
