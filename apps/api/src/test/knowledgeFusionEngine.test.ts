import { test } from "node:test";
import assert from "node:assert";
import { fuseCompetitorProfiles, fuseKnowledge, type CompetitorFusionEntry } from "../research/knowledge/KnowledgeFusionEngine.js";
import type { ProviderResult } from "../research/types/index.js";

function fakeCompetitorEntry(overrides: Partial<CompetitorFusionEntry> = {}): CompetitorFusionEntry {
  return {
    name: "Acme Corp",
    pricing: "$50/mo",
    positioning: "Enterprise-grade widget platform",
    confidence: 0.7,
    mentionedBySourceCount: 1,
    ...overrides,
  };
}

function fakeResult(provider: string, overrides: Partial<ProviderResult<unknown>> = {}): ProviderResult<unknown> {
  const now = new Date().toISOString();
  return {
    provider,
    status: "success",
    data: { dataSource: "test" },
    citations: [],
    evidence: [],
    startedAt: now,
    completedAt: now,
    durationMs: 1,
    attempt: 1,
    confidence: 0.8,
    ...overrides,
  };
}

test("fuseKnowledge - authorityByProvider uses the static table, defaulting unknown providers to 0.5", () => {
  const report = fuseKnowledge([fakeResult("website"), fakeResult("some-future-provider")]);
  assert.strictEqual(report.authorityByProvider.website, 0.95);
  assert.strictEqual(report.authorityByProvider["some-future-provider"], 0.5);
});

test("fuseKnowledge - fusedConfidenceByProvider multiplies confidence by authority, and overallFusedConfidence averages them", () => {
  const report = fuseKnowledge([
    fakeResult("website", { confidence: 1 }),   // authority 0.95 -> fused 0.95
    fakeResult("search", { confidence: 1 }),    // authority 0.55 -> fused 0.55
  ]);
  assert.strictEqual(report.fusedConfidenceByProvider.website, 0.95);
  assert.strictEqual(report.fusedConfidenceByProvider.search, 0.55);
  assert.strictEqual(report.overallFusedConfidence, 0.75);
});

test("fuseKnowledge - flags a 'success' result with suspiciously low confidence as a conflict", () => {
  const report = fuseKnowledge([fakeResult("company", { confidence: 0.2 })]);
  assert.strictEqual(report.conflicts.length, 1);
  assert.strictEqual(report.conflicts[0].kind, "low-grounding-despite-success");
  assert.deepStrictEqual(report.conflicts[0].sources, ["company"]);
});

test("fuseKnowledge - does NOT flag a 'partial' result with low confidence (only 'success' is suspicious)", () => {
  const report = fuseKnowledge([fakeResult("company", { status: "partial", confidence: 0.1 })]);
  assert.strictEqual(report.conflicts.length, 0);
});

test("fuseKnowledge - flags a market/competitor intensity mismatch at opposite extremes", () => {
  const report = fuseKnowledge([
    fakeResult("market", { data: { competitionLevel: "Low competition, an underserved niche", dataSource: "x" } }),
    fakeResult("competitor", { data: { competitionIntensity: "Highly saturated and fiercely competitive", dataSource: "x" } }),
  ]);
  const mismatch = report.conflicts.find((c) => c.kind === "market-competitor-intensity-mismatch");
  assert.ok(mismatch, "expected a market-competitor-intensity-mismatch conflict");
  assert.deepStrictEqual(mismatch!.sources, ["market", "competitor"]);
  assert.strictEqual(mismatch!.severity, "high");
});

test("fuseKnowledge - does NOT flag agreement or a 'medium' reading against either extreme", () => {
  const agree = fuseKnowledge([
    fakeResult("market", { data: { competitionLevel: "High competition", dataSource: "x" } }),
    fakeResult("competitor", { data: { competitionIntensity: "Very competitive market", dataSource: "x" } }),
  ]);
  assert.strictEqual(agree.conflicts.filter((c) => c.kind === "market-competitor-intensity-mismatch").length, 0);

  const oneMedium = fuseKnowledge([
    fakeResult("market", { data: { competitionLevel: "Moderate, growing steadily", dataSource: "x" } }),
    fakeResult("competitor", { data: { competitionIntensity: "Highly saturated", dataSource: "x" } }),
  ]);
  assert.strictEqual(oneMedium.conflicts.filter((c) => c.kind === "market-competitor-intensity-mismatch").length, 0);
});

test("fuseKnowledge - explainability has one entry per provider with the expected shape", () => {
  const report = fuseKnowledge([fakeResult("website", { confidence: 0.9 })]);
  assert.strictEqual(report.explainability.length, 1);
  const entry = report.explainability[0];
  assert.strictEqual(entry.provider, "website");
  assert.strictEqual(entry.status, "success");
  assert.strictEqual(entry.confidence, 0.9);
  assert.strictEqual(entry.authority, 0.95);
  assert.strictEqual(entry.fusedConfidence, Math.round(0.9 * 0.95 * 100) / 100);
  assert.strictEqual(entry.dataSource, "test");
});

test("fuseKnowledge - an empty result set produces an empty report, not a crash", () => {
  const report = fuseKnowledge([]);
  assert.deepStrictEqual(report.conflicts, []);
  assert.deepStrictEqual(report.explainability, []);
  assert.strictEqual(report.overallFusedConfidence, 0);
});

test("fuseCompetitorProfiles - corroboration by more independent sources raises fused confidence", () => {
  const report = fuseCompetitorProfiles([
    fakeCompetitorEntry({ name: "Solo Co", mentionedBySourceCount: 1 }),
    fakeCompetitorEntry({ name: "Corroborated Co", mentionedBySourceCount: 3 }),
  ]);
  assert.ok(
    report.fusedConfidenceByCompetitor["Corroborated Co"] > report.fusedConfidenceByCompetitor["Solo Co"],
    "a competitor named by 3 independent sources should end up with higher fused confidence than one named by only 1"
  );
});

test("fuseCompetitorProfiles - flags a competitor profile with low confidence", () => {
  const report = fuseCompetitorProfiles([fakeCompetitorEntry({ confidence: 0.2 })]);
  const conflict = report.conflicts.find((c) => c.kind === "low-grounding-competitor-profile");
  assert.ok(conflict, "expected a low-grounding-competitor-profile conflict");
  assert.deepStrictEqual(conflict!.sources, ["Acme Corp"]);
});

test("fuseCompetitorProfiles - does NOT flag a well-grounded competitor profile", () => {
  const report = fuseCompetitorProfiles([fakeCompetitorEntry({ confidence: 0.8 })]);
  assert.strictEqual(report.conflicts.filter((c) => c.kind === "low-grounding-competitor-profile").length, 0);
});

test("fuseCompetitorProfiles - flags drift when pricing/positioning materially differs from a prior Research Memory profile", () => {
  const report = fuseCompetitorProfiles([
    fakeCompetitorEntry({ pricing: "$50/mo", priorPricing: "$20/mo" }),
  ]);
  const conflict = report.conflicts.find((c) => c.kind === "competitor-profile-drift");
  assert.ok(conflict, "expected a competitor-profile-drift conflict when pricing changed");
});

test("fuseCompetitorProfiles - does NOT flag drift when there's no prior profile, or when nothing changed", () => {
  const noPrior = fuseCompetitorProfiles([fakeCompetitorEntry()]);
  assert.strictEqual(noPrior.conflicts.filter((c) => c.kind === "competitor-profile-drift").length, 0);

  const unchanged = fuseCompetitorProfiles([
    fakeCompetitorEntry({ pricing: "$50/mo", priorPricing: "$50/mo", positioning: "Same", priorPositioning: "Same" }),
  ]);
  assert.strictEqual(unchanged.conflicts.filter((c) => c.kind === "competitor-profile-drift").length, 0);
});

test("fuseCompetitorProfiles - an empty list produces an empty report, not a crash", () => {
  const report = fuseCompetitorProfiles([]);
  assert.deepStrictEqual(report.conflicts, []);
  assert.strictEqual(report.overallConfidence, 0);
});
