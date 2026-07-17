import { llm } from "../../infra/llmClient.js";
import { getMetadataByDedupKey, writeMemory } from "../memory/MemoryCoordinator.js";
import { fuseCompetitorProfiles, type CompetitorFusionEntry } from "../knowledge/KnowledgeFusionEngine.js";
import { discoverCompetitors, type DiscoveryInput } from "./discovery.js";
import { enrichCompetitor } from "./enrichment.js";
import { persistCompetitorIntelligenceReport } from "./competitorPersistence.js";
import type { CompetitorIntelligenceReport, CompetitorProfile } from "./types.js";

// Cost/latency ceiling — each enriched competitor is one real web search + one structured
// extraction call. Discovery can surface a dozen+ names across 3 sources; only the most
// independently-corroborated ones get the expensive deep-dive. Set to 8 so the competitive set
// shown to the user clears a meaningful bar (each extra name past 6 adds one search + one
// extraction call).
const MAX_ENRICHED_COMPETITORS = 8;
const MEMORY_KIND = "competitor-profile";

export type CompetitorIntelligenceInput = DiscoveryInput;

function dedupKeyFor(name: string): string {
  return name.trim().toLowerCase();
}

/** Looks up whatever this same competitor's last-recorded profile said (if any) — the
 * source of "priorPricing"/"priorPositioning" for fuseCompetitorProfiles' drift check. An
 * exact dedupKey lookup via MemoryCoordinator (name+workspace), not a similarity search —
 * "did we already profile THIS competitor" is an identity question, not a fuzzy-match one. */
async function findPriorProfile(name: string, input: CompetitorIntelligenceInput): Promise<{ pricing?: string; positioning?: string } | undefined> {
  if (!llm) return undefined;
  const metadata = await getMetadataByDedupKey(MEMORY_KIND, input.workspaceId, dedupKeyFor(name));
  return metadata ? { pricing: metadata.pricing as string | undefined, positioning: metadata.positioning as string | undefined } : undefined;
}

async function writeProfileToMemory(profile: CompetitorProfile, input: CompetitorIntelligenceInput): Promise<void> {
  try {
    await writeMemory({
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      kind: MEMORY_KIND,
      sourceUrl: input.url,
      dedupKey: dedupKeyFor(profile.name),
      content: `${profile.name}: ${profile.positioning} Pricing: ${profile.pricing}. Target audience: ${profile.targetAudience}.`,
      metadata: profile as unknown as Record<string, unknown>,
    });
  } catch {
    // Research Memory is an enhancement, never a reason to fail the whole report.
  }
}

/**
 * The Competitor Intelligence Engine — collects competitors from 3 independent sources
 * (discovery.ts), deep-enriches the most corroborated ones into full profiles
 * (enrichment.ts), reconciles them through Knowledge Fusion (conflict detection,
 * corroboration-weighted confidence), and persists each profile to Research Memory so a
 * later run — for this business or any other in a similar space — can retrieve and build
 * on it instead of re-researching from scratch. Additive: does not touch CompetitorProvider,
 * KnowledgeAggregator, ResearchContext, or any queue/worker/route.
 */
export async function runCompetitorIntelligence(input: CompetitorIntelligenceInput): Promise<CompetitorIntelligenceReport> {
  const { competitors: discovered, sourcesUsed } = await discoverCompetitors(input);

  const toEnrich = [...discovered]
    .sort((a, b) => b.mentionedBy.length - a.mentionedBy.length)
    .slice(0, MAX_ENRICHED_COMPETITORS);

  const profiles = await Promise.all(
    toEnrich.map(async (discoveredCompetitor) => {
      const [profile, prior] = await Promise.all([
        enrichCompetitor(discoveredCompetitor, { industry: input.industry }),
        findPriorProfile(discoveredCompetitor.name, input),
      ]);
      return { profile, prior };
    })
  );

  const fusionEntries: CompetitorFusionEntry[] = profiles.map(({ profile, prior }) => ({
    name: profile.name,
    pricing: profile.pricing,
    positioning: profile.positioning,
    confidence: profile.confidence,
    mentionedBySourceCount: profile.mentionedBySourceCount,
    priorPricing: prior?.pricing,
    priorPositioning: prior?.positioning,
  }));
  const fusion = fuseCompetitorProfiles(fusionEntries);

  const finalProfiles: CompetitorProfile[] = profiles.map(({ profile }) => ({
    ...profile,
    confidence: fusion.fusedConfidenceByCompetitor[profile.name] ?? profile.confidence,
  }));

  await Promise.all(finalProfiles.map((profile) => writeProfileToMemory(profile, input)));

  const report: CompetitorIntelligenceReport = {
    businessUrl: input.url,
    businessName: input.businessName,
    competitors: finalProfiles,
    sourcesUsed,
    fusion: { conflicts: fusion.conflicts, overallConfidence: fusion.overallConfidence },
    generatedAt: new Date().toISOString(),
  };

  // Additive relational persistence (Competitor/CompetitorProfile) alongside the Research
  // Memory write above — only possible when this run is scoped to a real business.
  if (input.businessId) {
    await persistCompetitorIntelligenceReport(input.businessId, input.workspaceId, report);
  }

  return report;
}
