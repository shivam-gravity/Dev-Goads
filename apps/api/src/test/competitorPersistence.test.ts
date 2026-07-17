import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { persistCompetitorIntelligenceReport } from "../research/competitor-intelligence/competitorPersistence.js";
import type { CompetitorIntelligenceReport } from "../research/competitor-intelligence/types.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

function fakeReport(overrides: Partial<CompetitorIntelligenceReport> = {}): CompetitorIntelligenceReport {
  return {
    businessUrl: "https://example.com",
    businessName: "Example Inc",
    competitors: [
      {
        name: "Rival Co",
        url: "https://rival.example.com",
        positioning: "Premium, enterprise-first",
        pricing: "$99-$499/mo",
        targetAudience: "Mid-market",
        valueProposition: "Faster onboarding",
        strengths: ["Strong brand"],
        weaknesses: ["Expensive"],
        technologyStack: ["React"],
        estimatedMarketingStrategy: "Paid search + content",
        marketShare: "~20%",
        estimatedAdBudget: "$50K-$100K/mo (estimated)",
        differentiation: "Enterprise SSO",
        evidence: ["Rival Co overview (https://rival.example.com)"],
        citations: [{ url: "https://rival.example.com", title: "Rival Co overview" }],
        confidence: 0.75,
        mentionedBySourceCount: 2,
      },
    ],
    sourcesUsed: ["direct-search", "alternatives-search"],
    fusion: { conflicts: [], overallConfidence: 0.75 },
    generatedAt: "now",
    ...overrides,
  };
}

async function createFixtureBusiness(): Promise<{ businessId: string; workspaceId: string }> {
  const businessId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.business.create({ data: { id: businessId, workspaceId, data: { id: businessId, name: "Fixture Co" } as any } });
  return { businessId, workspaceId };
}

async function cleanup(businessId: string): Promise<void> {
  const competitors = await prisma.competitor.findMany({ where: { businessId } });
  for (const c of competitors) {
    await prisma.competitorProfile.deleteMany({ where: { competitorId: c.id } });
  }
  await prisma.competitor.deleteMany({ where: { businessId } });
  await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
}

test("persistCompetitorIntelligenceReport - creates a relational Competitor + CompetitorProfile row from the engine's report", async () => {
  const { businessId, workspaceId } = await createFixtureBusiness();
  try {
    await persistCompetitorIntelligenceReport(businessId, workspaceId, fakeReport());

    const competitor = await prisma.competitor.findUnique({ where: { businessId_name: { businessId, name: "Rival Co" } } });
    assert.ok(competitor, "expected a Competitor row to be created");
    assert.strictEqual(competitor?.domain, "rival.example.com");
    assert.ok(competitor?.lastEnrichedAt, "expected lastEnrichedAt to be set");

    const profiles = await prisma.competitorProfile.findMany({ where: { competitorId: competitor!.id } });
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0]?.positioning, "Premium, enterprise-first");
    assert.strictEqual(profiles[0]?.marketShare, "~20%");
    assert.strictEqual(profiles[0]?.mentionedBySourceCount, 2);
  } finally {
    await cleanup(businessId);
  }
});

test("persistCompetitorIntelligenceReport - re-running preserves profile history instead of overwriting the prior CompetitorProfile row", async () => {
  const { businessId, workspaceId } = await createFixtureBusiness();
  try {
    await persistCompetitorIntelligenceReport(businessId, workspaceId, fakeReport());
    await persistCompetitorIntelligenceReport(businessId, workspaceId, fakeReport({
      competitors: [{ ...fakeReport().competitors[0]!, pricing: "$149-$599/mo (price increase)" }],
    }));

    const competitor = await prisma.competitor.findUnique({ where: { businessId_name: { businessId, name: "Rival Co" } } });
    const profiles = await prisma.competitorProfile.findMany({ where: { competitorId: competitor!.id }, orderBy: { generatedAt: "asc" } });

    assert.strictEqual(profiles.length, 2, "expected both enrichment runs to be preserved as separate rows");
    assert.strictEqual(profiles[0]?.pricing, "$99-$499/mo");
    assert.strictEqual(profiles[1]?.pricing, "$149-$599/mo (price increase)");
  } finally {
    await cleanup(businessId);
  }
});

test("persistCompetitorIntelligenceReport - never throws even when given a nonexistent businessId", async () => {
  await assert.doesNotReject(() => persistCompetitorIntelligenceReport("nonexistent-business-id", "ws-1", fakeReport()));
});
