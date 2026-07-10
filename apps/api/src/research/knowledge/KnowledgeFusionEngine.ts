import type { ProviderResult, ResearchProviderStatus } from "../types/index.js";
import { freshnessScore } from "./freshness.js";

/**
 * Static per-provider authority weight (0-1) — a rough, hand-set prior on how much a
 * downstream consumer should trust THIS CHANNEL's data before even looking at a specific
 * result's confidence. Deterministic, code-derived providers (crawled markup, response
 * headers, on-page text) can't hallucinate the way an AI-estimated web-search synthesis
 * can, so they start higher. This is independent of (and multiplied with) per-result
 * confidence in fusedConfidenceByProvider below — a high-authority provider that reports
 * low confidence still ends up with a low fused score, and vice versa.
 */
const PROVIDER_AUTHORITY: Record<string, number> = {
  website: 0.95,
  technology: 0.95,
  seo: 0.9,
  company: 0.65,
  market: 0.65,
  competitor: 0.65,
  audience: 0.6,
  news: 0.6,
  search: 0.55,
};
const DEFAULT_AUTHORITY = 0.5;

// A "success" status paired with confidence below this is an internal inconsistency
// worth surfacing on its own — the provider is vouching for its result while the
// confidence machinery (see research/providers/support.ts) doesn't really trust it.
const LOW_GROUNDING_CONFIDENCE_THRESHOLD = 0.4;

export interface FusionConflict {
  kind: "low-grounding-despite-success" | "market-competitor-intensity-mismatch" | "competitor-profile-drift" | "low-grounding-competitor-profile";
  description: string;
  severity: "low" | "medium" | "high";
  sources: string[];
}

export interface FieldExplanation {
  provider: string;
  status: ResearchProviderStatus;
  confidence: number;
  authority: number;
  fusedConfidence: number;
  dataSource?: string;
  generatedAt: string;
}

export interface KnowledgeFusionReport {
  authorityByProvider: Record<string, number>;
  fusedConfidenceByProvider: Record<string, number>;
  overallFusedConfidence: number;
  conflicts: FusionConflict[];
  explainability: FieldExplanation[];
}

type IntensityBucket = "low" | "medium" | "high";

const HIGH_INTENSITY_KEYWORDS = ["high", "intense", "saturated", "crowded", "competitive", "fierce", "many", "numerous"];
const LOW_INTENSITY_KEYWORDS = ["low", "few", "limited", "underserved", "niche", "sparse", "minimal", "emerging", "little"];

/** Coarse free-text -> {low, medium, high} bucketing, not real sentiment analysis —
 * cheap and good enough to catch a genuine disagreement (one field says "low
 * competition", another implies "high") without a second model call. Text matching
 * neither keyword list buckets to "medium" (the safe, non-alarming default) rather than
 * guessing, since a false conflict is worse than a missed one here. */
function bucketIntensity(text: string): IntensityBucket {
  const lower = text.toLowerCase();
  if (HIGH_INTENSITY_KEYWORDS.some((k) => lower.includes(k))) return "high";
  if (LOW_INTENSITY_KEYWORDS.some((k) => lower.includes(k))) return "low";
  return "medium";
}

function detectConflicts(results: ProviderResult<unknown>[]): FusionConflict[] {
  const conflicts: FusionConflict[] = [];
  const byName = new Map(results.map((r) => [r.provider, r]));

  for (const result of results) {
    if (result.status === "success" && result.confidence < LOW_GROUNDING_CONFIDENCE_THRESHOLD) {
      conflicts.push({
        kind: "low-grounding-despite-success",
        description: `${result.provider} reported "success" but its confidence (${result.confidence}) suggests the result isn't well-grounded — likely an AI estimate dressed up as a real finding.`,
        severity: "medium",
        sources: [result.provider],
      });
    }
  }

  const market = byName.get("market");
  const competitor = byName.get("competitor");
  const marketLevel = (market?.data as { competitionLevel?: string } | null)?.competitionLevel;
  const competitorIntensity = (competitor?.data as { competitionIntensity?: string } | null)?.competitionIntensity;
  if (marketLevel && competitorIntensity) {
    const marketBucket = bucketIntensity(marketLevel);
    const competitorBucket = bucketIntensity(competitorIntensity);
    const isOppositeExtremes = (marketBucket === "low" && competitorBucket === "high") || (marketBucket === "high" && competitorBucket === "low");
    if (isOppositeExtremes) {
      conflicts.push({
        kind: "market-competitor-intensity-mismatch",
        description: `Market research describes competition as "${marketLevel}" while Competitor research describes it as "${competitorIntensity}" — these read as opposite assessments and should be reconciled before use.`,
        severity: "high",
        sources: ["market", "competitor"],
      });
    }
  }

  return conflicts;
}

/**
 * Knowledge Fusion — the reconciliation step between "9 independent providers each
 * returned something" and "one coherent, trustworthy view a downstream consumer (an AI
 * Agent, a human) can act on without re-deriving all of this themselves." Attached to
 * ResearchContextMetadata.fusion (additive — nothing that reads the pre-existing
 * confidenceByProvider/overallConfidence needs to change). Never throws: a provider with
 * an unrecognized name just gets DEFAULT_AUTHORITY rather than blowing up fusion for the
 * other 8.
 */
export function fuseKnowledge(results: ProviderResult<unknown>[]): KnowledgeFusionReport {
  const authorityByProvider: Record<string, number> = {};
  const fusedConfidenceByProvider: Record<string, number> = {};
  const explainability: FieldExplanation[] = [];

  for (const result of results) {
    const authority = PROVIDER_AUTHORITY[result.provider] ?? DEFAULT_AUTHORITY;
    const fused = Math.round(result.confidence * authority * 100) / 100;
    authorityByProvider[result.provider] = authority;
    fusedConfidenceByProvider[result.provider] = fused;

    explainability.push({
      provider: result.provider,
      status: result.status,
      confidence: result.confidence,
      authority,
      fusedConfidence: fused,
      dataSource: (result.data as { dataSource?: string } | null)?.dataSource,
      generatedAt: result.completedAt,
    });
  }

  const overallFusedConfidence = results.length > 0
    ? Math.round((Object.values(fusedConfidenceByProvider).reduce((sum, v) => sum + v, 0) / results.length) * 100) / 100
    : 0;

  return {
    authorityByProvider,
    fusedConfidenceByProvider,
    overallFusedConfidence,
    conflicts: detectConflicts(results),
    explainability,
  };
}

// Below LOW_GROUNDING_CONFIDENCE_THRESHOLD's counterpart for individually-enriched
// entities (a competitor profile, not a provider) — same "something claims to be a real
// finding but isn't well-grounded" concern, tuned separately since these are scored by
// enrichment.ts's own formula, not research/providers/support.ts's.
const LOW_GROUNDING_COMPETITOR_THRESHOLD = 0.35;

// A materially different pricing/positioning string between what Research Memory last
// recorded for this competitor and what THIS run's enrichment found — cheap non-empty/
// non-equal string check, not semantic diffing, so it only fires on a genuine textual
// change (not, e.g., whitespace/capitalization noise a stricter check might miss anyway).
function textDrifted(prior: string | undefined, current: string): boolean {
  if (!prior) return false;
  return prior.trim().toLowerCase() !== current.trim().toLowerCase();
}

/** Minimal, decoupled-on-purpose shape — NOT the real CompetitorProfile type from
 * research/competitor-intelligence/types.ts, so this file never imports from that
 * engine (avoids a cycle, and keeps Knowledge Fusion usable by any future per-entity
 * multi-source caller, not just competitor intelligence specifically). */
export interface CompetitorFusionEntry {
  name: string;
  pricing: string;
  positioning: string;
  confidence: number;
  mentionedBySourceCount: number;
  /** From a matching Research Memory entry for this same competitor, if one existed
   * before this run — omit when there's no prior profile to compare against. */
  priorPricing?: string;
  priorPositioning?: string;
}

export interface CompetitorFusionResult {
  fusedConfidenceByCompetitor: Record<string, number>;
  overallConfidence: number;
  conflicts: FusionConflict[];
}

/**
 * Knowledge Fusion for the Competitor Intelligence Engine — same reconciliation JOB as
 * fuseKnowledge above (turn N independent reads into one trustworthy view + surfaced
 * disagreements), applied to per-competitor entities instead of per-provider fields.
 * Corroboration (more discovery sources agreeing a competitor exists) nudges confidence
 * up; a prior Research Memory profile that materially disagrees with this run's fresh
 * enrichment is a drift conflict worth flagging (could mean the competitor repositioned,
 * or one of the two reads is wrong) rather than silently overwriting.
 */
export function fuseCompetitorProfiles(entries: CompetitorFusionEntry[]): CompetitorFusionResult {
  const fusedConfidenceByCompetitor: Record<string, number> = {};
  const conflicts: FusionConflict[] = [];

  for (const entry of entries) {
    const corroborationBonus = Math.min((entry.mentionedBySourceCount - 1) * 0.03, 0.09);
    const fused = Math.round(Math.min(entry.confidence + corroborationBonus, 1) * 100) / 100;
    fusedConfidenceByCompetitor[entry.name] = fused;

    if (entry.confidence < LOW_GROUNDING_COMPETITOR_THRESHOLD) {
      conflicts.push({
        kind: "low-grounding-competitor-profile",
        description: `"${entry.name}"'s profile has low confidence (${entry.confidence}) — likely thin or no real research behind it, despite being included in the report.`,
        severity: "medium",
        sources: [entry.name],
      });
    }

    if (textDrifted(entry.priorPricing, entry.pricing) || textDrifted(entry.priorPositioning, entry.positioning)) {
      conflicts.push({
        kind: "competitor-profile-drift",
        description: `"${entry.name}"'s pricing/positioning in this run differs from what Research Memory previously recorded — could be a real change or a disagreement between research passes; verify before relying on either.`,
        severity: "medium",
        sources: [entry.name, "research-memory"],
      });
    }
  }

  const overallConfidence = entries.length > 0
    ? Math.round((Object.values(fusedConfidenceByCompetitor).reduce((sum, v) => sum + v, 0) / entries.length) * 100) / 100
    : 0;

  return { fusedConfidenceByCompetitor, overallConfidence, conflicts };
}

/** How stale a completed ResearchContext is, given when it was generated — exported for
 * a future "should this business's research be re-run" decision (not consumed by any
 * route yet); unlike ResearchMemoryStore's use of freshnessScore, a fresh context is
 * always 1.0 at generation time, so this only becomes interesting once a caller reads
 * back an older persisted ResearchJob (e.g. via GET /research/:id) well after it ran. */
export function contextFreshness(generatedAt: string, ttlMs: number): number {
  return freshnessScore(generatedAt, ttlMs);
}
