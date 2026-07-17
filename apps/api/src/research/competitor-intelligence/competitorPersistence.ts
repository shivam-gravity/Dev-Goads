import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../modules/logger/logger.js";
import { hostnameOf } from "../providers/support.js";
import type { CompetitorIntelligenceReport } from "./types.js";

/**
 * Persists a Competitor Intelligence Engine report onto the relational Competitor/
 * CompetitorProfile tables — additive alongside (never replacing) the existing Research
 * Memory write in CompetitorIntelligenceEngine.ts, which stays the corroboration/dedup
 * source `discovery.ts`'s "research-memory" source reads from. This is what makes a
 * competitor a queryable, rankable, refreshable entity instead of only a semantic-search
 * embedding blob. Best-effort: never throws — a persistence failure here must never affect
 * the CompetitorData the 27-provider research pipeline already returned successfully.
 */
export async function persistCompetitorIntelligenceReport(
  businessId: string,
  workspaceId: string,
  report: CompetitorIntelligenceReport
): Promise<void> {
  try {
    for (const profile of report.competitors) {
      const domain = profile.url ? hostnameOf(profile.url).replace(/^www\./i, "") || null : null;

      const competitor = await prisma.competitor.upsert({
        where: { businessId_name: { businessId, name: profile.name } },
        create: {
          id: randomUUID(),
          businessId,
          workspaceId,
          name: profile.name,
          domain,
          discoverySources: [], // discovery.ts's per-source mentionedBy isn't surfaced on CompetitorProfile — captured via sourcesUsed at the report level instead
          lastEnrichedAt: new Date(),
        },
        // Write the freshly-computed domain, null INCLUDED — a re-enrichment that resolves no
        // trustworthy domain must CLEAR a previously-stored one, not silently keep it. The old
        // `domain ?? undefined` skipped the column on null (Prisma treats undefined as "leave
        // unchanged"), which froze stale citation-host domains in place forever (a re-run could
        // never heal them). No run currently produces a *good* domain (homepage resolution is
        // deferred — see Bucket B), so `?? undefined` only ever preserved garbage; and even once
        // real domains exist, latest-wins is still the wanted behavior.
        update: { domain, lastEnrichedAt: new Date() },
      });

      await prisma.competitorProfile.create({
        data: {
          id: randomUUID(),
          competitorId: competitor.id,
          positioning: profile.positioning,
          pricing: profile.pricing,
          targetAudience: profile.targetAudience,
          valueProposition: profile.valueProposition,
          strengths: profile.strengths,
          weaknesses: profile.weaknesses,
          technologyStack: profile.technologyStack,
          estimatedMarketingStrategy: profile.estimatedMarketingStrategy,
          marketShare: profile.marketShare,
          estimatedAdBudget: profile.estimatedAdBudget,
          differentiation: profile.differentiation,
          confidence: profile.confidence,
          mentionedBySourceCount: profile.mentionedBySourceCount,
          citations: profile.citations as any,
        },
      });
    }
  } catch (err) {
    logger.warn(`Competitor relational persistence failed for business ${businessId} — the Research Memory copy of this report is unaffected`, err);
  }
}
