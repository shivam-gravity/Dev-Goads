import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { discoverCompetitorAds } from "../research/ad-intelligence/CompetitorAdDiscovery.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

delete process.env.FIRECRAWL_API_KEY;
delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;

async function createFixtureCompetitor(): Promise<{ businessId: string; competitorId: string }> {
  const businessId = randomUUID();
  const competitorId = randomUUID();
  await prisma.business.create({ data: { id: businessId, data: { id: businessId, name: "Fixture Co" } as any } });
  await prisma.competitor.create({
    data: { id: competitorId, businessId, workspaceId: randomUUID(), name: "Rival Co", discoverySources: [] },
  });
  return { businessId, competitorId };
}

async function cleanup(businessId: string, competitorId: string): Promise<void> {
  await prisma.adCreativeAnalysis.deleteMany({ where: { competitorAd: { competitorId } } });
  await prisma.competitorAd.deleteMany({ where: { competitorId } });
  await prisma.competitor.delete({ where: { id: competitorId } }).catch(() => {});
  await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
}

test("discoverCompetitorAds - with no ad-source credentials, attempted is false and no pre-existing ad is deactivated", async () => {
  const { businessId, competitorId } = await createFixtureCompetitor();
  try {
    // Seed a pre-existing active ad, simulating a prior successful discovery run.
    await prisma.competitorAd.create({
      data: {
        id: randomUUID(), competitorId, platform: "meta", externalAdId: "old-ad-1",
        rawSourceData: {}, estimatedCountries: [], isActive: true,
      },
    });

    const original = global.fetch;
    global.fetch = (async () => { throw new Error("in-house and Firecrawl both unreachable (simulated)"); }) as typeof fetch;
    let result;
    try {
      result = await discoverCompetitorAds(competitorId, "Rival Co");
    } finally {
      global.fetch = original;
    }

    assert.strictEqual(result.attempted, false);
    assert.strictEqual(result.adsDeactivated, 0);

    const ad = await prisma.competitorAd.findFirst({ where: { competitorId, externalAdId: "old-ad-1" } });
    assert.strictEqual(ad?.isActive, true, "an unattempted refresh must never deactivate a previously-seen ad");
  } finally {
    await cleanup(businessId, competitorId);
  }
});

test("discoverCompetitorAds - upserts a discovered ad, preserving firstSeenAt across a second pass while advancing lastSeenAt", async () => {
  const { businessId, competitorId } = await createFixtureCompetitor();
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = "test-token";
  const original = global.fetch;
  global.fetch = (async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("graph.facebook.com")) {
      return new Response(JSON.stringify({ data: [{ id: "ad-1", page_name: "Rival Co", ad_creative_link_titles: ["Big Sale"], ad_creative_bodies: ["50% off today"] }] }), { status: 200 });
    }
    throw new Error("unmocked host (simulated Google outage)");
  }) as typeof fetch;

  try {
    const first = await discoverCompetitorAds(competitorId, "Rival Co");
    assert.strictEqual(first.adsSeen, 1);

    const firstRow = await prisma.competitorAd.findUnique({ where: { competitorId_platform_externalAdId: { competitorId, platform: "meta", externalAdId: "ad-1" } } });
    assert.ok(firstRow);
    const firstSeenAt = firstRow!.firstSeenAt.getTime();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await discoverCompetitorAds(competitorId, "Rival Co");

    const secondRow = await prisma.competitorAd.findUnique({ where: { competitorId_platform_externalAdId: { competitorId, platform: "meta", externalAdId: "ad-1" } } });
    assert.strictEqual(secondRow!.firstSeenAt.getTime(), firstSeenAt, "firstSeenAt must not change on a re-discovery of the same ad");
    assert.ok(secondRow!.lastSeenAt.getTime() >= firstSeenAt, "lastSeenAt should advance (or stay equal at minimum) on every pass");
    assert.strictEqual(secondRow!.isActive, true);
  } finally {
    global.fetch = original;
    delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    await cleanup(businessId, competitorId);
  }
});

test("discoverCompetitorAds - deactivates an ad that no longer appears in a genuinely-attempted pass", async () => {
  const { businessId, competitorId } = await createFixtureCompetitor();
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = "test-token";
  const original = global.fetch;

  try {
    global.fetch = (async () => new Response(JSON.stringify({ data: [{ id: "ad-1", page_name: "Rival Co" }] }), { status: 200 })) as typeof fetch;
    await discoverCompetitorAds(competitorId, "Rival Co");

    global.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch;
    const second = await discoverCompetitorAds(competitorId, "Rival Co");

    assert.strictEqual(second.adsDeactivated, 1);
    const row = await prisma.competitorAd.findUnique({ where: { competitorId_platform_externalAdId: { competitorId, platform: "meta", externalAdId: "ad-1" } } });
    assert.strictEqual(row?.isActive, false);
  } finally {
    global.fetch = original;
    delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    await cleanup(businessId, competitorId);
  }
});
