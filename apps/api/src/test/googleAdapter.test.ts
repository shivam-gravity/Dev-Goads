import { test } from "node:test";
import assert from "node:assert";

// See metaAdapter.test.ts's identical guard for why: this file's "mock mode" assumptions
// break if a real credential leaked into process.env from an earlier test file in the same
// combined `npm test` process.
delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
delete process.env.GOOGLE_ADS_CUSTOMER_ID;
delete process.env.GOOGLE_ADS_ACCESS_TOKEN;

const { googleAdapter } = await import("../modules/adapters/googleAdapter.js");

test("Google Ads Adapter - launchVariant fallback placement validation", async () => {
  const result = await googleAdapter.launchVariant({
    campaignId: "camp-test-1",
    variantId: "var-test-1",
    creative: { headline: "Scale Your Lead Gen in 15 Mins", body: "Automated campaigns that convert.", callToAction: "Learn More" },
    dailyBudgetCents: 10000,
  });

  assert.ok(result.externalId, "Should generate a mock ad ID");
  assert.strictEqual(result.status, "active", "Mock ad state should be active");
  assert.ok(result.externalId.startsWith("gads_ad_"), "Ad ID should follow google prefix pattern");
});

test("Google Ads Adapter - fetchInsights mock metrics ranges", async () => {
  const stats = await googleAdapter.fetchInsights("gads_ad_test", new Date().toISOString().slice(0, 10));

  assert.ok(stats.impressions >= 1500, "Impressions should be within mock bounds");
  assert.ok(stats.clicks <= stats.impressions, "Clicks cannot exceed impressions");
  assert.ok(stats.conversions <= stats.clicks, "Conversions cannot exceed clicks");
  assert.ok(stats.spendCents > 0, "Spend must be greater than zero");
});

// ── createAdSetContainer ad-group-criteria emission (negative keywords) ──
// Explicit credentials are passed so resolveCredentials returns them and the method reaches the
// real criteria-building block (rather than the no-credentials early mock-return). globalThis.fetch
// is stubbed per-test — the adGroups create call must succeed first so createAdSetContainer has an
// ad-group resource name before it issues the adGroupCriteria mutate we're asserting on.
const EXPLICIT_GOOGLE_CREDS = { accessToken: "tok", customerId: "1", developerToken: "dev" };
const AD_GROUP_RESOURCE = "customers/1/adGroups/123";

function stubGoogleFetch(onCriteria: (ops: any[]) => Response): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => {
    const u = String(url);
    if (u.includes("/adGroups:mutate")) {
      return new Response(JSON.stringify({ results: [{ resourceName: AD_GROUP_RESOURCE }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/adGroupCriteria:mutate")) {
      return onCriteria(JSON.parse(options.body).operations);
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

test("Google Ads Adapter - createAdSetContainer emits negative-keyword ops alongside positives when negativeKeywords is non-empty", async () => {
  let capturedOps: any[] | null = null;
  const restore = stubGoogleFetch((ops) => {
    capturedOps = ops;
    return new Response(JSON.stringify({ results: [{ resourceName: "customers/1/adGroupCriteria/456" }] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  try {
    const result = await googleAdapter.createAdSetContainer!(
      {
        campaignExternalId: "customers/1/campaigns/1",
        name: "AG",
        dailyBudgetCents: 1000,
        targeting: { ageRanges: [], genders: [], keywords: ["running shoes"], negativeKeywords: ["free", "cheap"] },
      },
      EXPLICIT_GOOGLE_CREDS
    );
    assert.strictEqual(result.externalId, AD_GROUP_RESOURCE);
    assert.ok(capturedOps, "adGroupCriteria:mutate must have been called");
    // capturedOps is only ever assigned inside the fetch stub's closure, which TS's control-flow
    // analysis can't see — so it stays typed `null` here despite the assert.ok guard above. Read
    // it through a typed local (assert.ok is the real not-null check) so the filters stay typed.
    const ops: any[] = capturedOps ?? [];
    const positives = ops.filter((o) => o.create.keyword && o.create.negative !== true);
    const negatives = ops.filter((o) => o.create.negative === true);
    assert.deepStrictEqual(positives.map((o) => o.create.keyword.text), ["running shoes"], "positive keyword op preserved");
    assert.strictEqual(negatives.length, 2, "one negative op per negative keyword");
    assert.deepStrictEqual(negatives[0].create, { adGroup: AD_GROUP_RESOURCE, negative: true, keyword: { text: "free", matchType: "BROAD" } });
    assert.deepStrictEqual(negatives[1].create, { adGroup: AD_GROUP_RESOURCE, negative: true, keyword: { text: "cheap", matchType: "BROAD" } });
  } finally {
    restore();
  }
});

test("Google Ads Adapter - createAdSetContainer emits no negative ops when negativeKeywords is empty/absent", async () => {
  let capturedOps: any[] | null = null;
  const restore = stubGoogleFetch((ops) => {
    capturedOps = ops;
    return new Response(JSON.stringify({ results: [{ resourceName: "customers/1/adGroupCriteria/456" }] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  try {
    // A positive keyword is present so the criteria mutate still fires; negativeKeywords omitted.
    await googleAdapter.createAdSetContainer!(
      {
        campaignExternalId: "customers/1/campaigns/1",
        name: "AG",
        dailyBudgetCents: 1000,
        targeting: { ageRanges: [], genders: [], keywords: ["running shoes"] },
      },
      EXPLICIT_GOOGLE_CREDS
    );
    assert.ok(capturedOps, "adGroupCriteria:mutate must have been called for the positive keyword");
    const ops: any[] = capturedOps ?? [];
    assert.strictEqual(ops.filter((o) => o.create.negative === true).length, 0, "no negative ops when none supplied");
  } finally {
    restore();
  }
});

test("Google Ads Adapter - createAdSetContainer swallows a rejected criteria mutate and still returns the ad group (launch survives)", async () => {
  const restore = stubGoogleFetch(() =>
    new Response("invalid negative keyword", { status: 400, headers: { "content-type": "text/plain" } })
  );

  try {
    // Criteria mutate returns 400 (after the adapter's internal retries) — createAdSetContainer must
    // catch it, log a warning, and still return the already-created ad group rather than throwing.
    const result = await googleAdapter.createAdSetContainer!(
      {
        campaignExternalId: "customers/1/campaigns/1",
        name: "AG",
        dailyBudgetCents: 1000,
        targeting: { ageRanges: [], genders: [], keywords: ["running shoes"], negativeKeywords: ["free"] },
      },
      EXPLICIT_GOOGLE_CREDS
    );
    assert.strictEqual(result.externalId, AD_GROUP_RESOURCE, "ad group is still returned despite the criteria failure");
  } finally {
    restore();
  }
});
