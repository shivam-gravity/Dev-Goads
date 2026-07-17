import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

// llmClient.ts's `llm` export (and mistralClient.ts's/groqClient.ts's own gates) are each
// computed once at module load from their respective env vars — a static top-level import
// would be hoisted ahead of the deletes below and always see whatever real keys happen to
// be loaded (several earlier-running test files in this same `npm test` process load
// dotenv/config, e.g. memoryCoordinator.test.ts, which pulls the real apps/api/.env
// GROQ_API_KEY into process.env for the rest of the process). A cache-busted dynamic
// import, run AFTER the deletes, is this codebase's established way to guarantee
// genuinely-unconfigured clients for these tests (see audienceIntelligenceEngine.test.ts).
delete process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.MISTRAL_API_KEY;
delete process.env.GEMINI_API_KEY;
const t = Date.now();
const { analyzeAdCreative, analyzeNewCompetitorAds } = await import(`../research/creative-intelligence/AdCreativeAnalyzer.js?t=${t}`);

test("analyzeAdCreative - with no LLM provider configured, degrades to a labeled low-confidence fallback", async () => {
  const result = await analyzeAdCreative({ id: "ad-1", platform: "meta", headline: "Big Sale", description: "50% off", cta: null, landingPageUrl: null });
  assert.strictEqual(result.confidence, 0.1);
  assert.match(result.hook, /no live analysis performed/);
});

test("analyzeAdCreative - an ad with no headline/description gets the same fallback confidence as one with content when there's no API key", async () => {
  const empty = await analyzeAdCreative({ id: "ad-1", platform: "meta", headline: null, description: null, cta: null, landingPageUrl: null });
  assert.strictEqual(empty.confidence, 0.1);
});

async function createFixtureCompetitorWithAds(): Promise<{ businessId: string; competitorId: string; adWithContentId: string; adWithoutContentId: string }> {
  const businessId = randomUUID();
  const competitorId = randomUUID();
  await prisma.business.create({ data: { id: businessId, data: { id: businessId, name: "Fixture Co" } as any } });
  await prisma.competitor.create({ data: { id: competitorId, businessId, workspaceId: randomUUID(), name: "Rival Co", discoverySources: [] } });

  const adWithContentId = randomUUID();
  const adWithoutContentId = randomUUID();
  await prisma.competitorAd.create({
    data: { id: adWithContentId, competitorId, platform: "meta", externalAdId: "ad-1", headline: "Big Sale", description: "50% off today", rawSourceData: {}, estimatedCountries: [] },
  });
  await prisma.competitorAd.create({
    data: { id: adWithoutContentId, competitorId, platform: "google", externalAdId: "ad-2", rawSourceData: {}, estimatedCountries: [] },
  });
  return { businessId, competitorId, adWithContentId, adWithoutContentId };
}

async function cleanup(businessId: string, competitorId: string): Promise<void> {
  await prisma.adCreativeAnalysis.deleteMany({ where: { competitorAd: { competitorId } } });
  await prisma.competitorAd.deleteMany({ where: { competitorId } });
  await prisma.competitor.delete({ where: { id: competitorId } }).catch(() => {});
  await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
}

test("analyzeNewCompetitorAds - analyzes every ad lacking a creative-analysis row and persists the result", async () => {
  const { businessId, competitorId, adWithContentId } = await createFixtureCompetitorWithAds();
  try {
    const analyzed = await analyzeNewCompetitorAds(competitorId);
    assert.strictEqual(analyzed, 2, "expected both ads (with and without content) to be analyzed");

    const analysis = await prisma.adCreativeAnalysis.findUnique({ where: { competitorAdId: adWithContentId } });
    assert.ok(analysis, "expected an AdCreativeAnalysis row for the ad with content");
    assert.strictEqual(analysis?.confidence, 0.1, "no OPENAI_API_KEY in this test env — expect the labeled fallback");
  } finally {
    await cleanup(businessId, competitorId);
  }
});

test("analyzeNewCompetitorAds - skips ads that already have a creative-analysis row (no duplicate rows)", async () => {
  const { businessId, competitorId, adWithContentId } = await createFixtureCompetitorWithAds();
  try {
    await analyzeNewCompetitorAds(competitorId);
    const secondPass = await analyzeNewCompetitorAds(competitorId);
    assert.strictEqual(secondPass, 0, "expected zero new analyses since both ads already have one");

    const count = await prisma.adCreativeAnalysis.count({ where: { competitorAdId: adWithContentId } });
    assert.strictEqual(count, 1);
  } finally {
    await cleanup(businessId, competitorId);
  }
});
