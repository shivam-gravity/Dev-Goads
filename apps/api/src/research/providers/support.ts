import { openai, runStructured, runWebSearch, type JsonSchemaTool } from "../../infra/openaiClient.js";
import type { Citation } from "../../types/index.js";
import type { ProviderResult, ResearchEvidenceItem, ResearchProviderStatus } from "../types/index.js";

interface ProviderOutcome<T> {
  status: ResearchProviderStatus;
  data: T | null;
  citations?: Citation[];
  evidence?: ResearchEvidenceItem[];
  error?: string;
}

/**
 * Generic 0-1 confidence score computed from signals every provider already reports —
 * deliberately provider-agnostic (no provider-specific branching) so a 10th provider gets
 * scoring for free. Reads `data.dataSource` opportunistically (every provider's data shape
 * includes it by convention, see research/types/index.ts) purely to detect the two known
 * "no real live data" fallback strings — anything else (a real citation-title join, a
 * deterministic signature-detection source, etc.) is treated as real grounding.
 *   - failed                          -> 0
 *   - base: success 0.6, partial 0.3
 *   - -0.25 if data came from a no-live-data fallback (no OPENAI_API_KEY, or a search
 *     that returned no citable sources)
 *   - up to +0.3 for evidence/citations (0.04 per item, diminishing via the cap — a
 *     provider with 8+ real sources tops out rather than scoring above a single-source one)
 *   - -0.1 if it needed a retry (attempt > 1) — it got there, but wasn't stable on try 1
 * Clamped to [0, 1] and rounded to 2 decimals so persisted/displayed values don't carry
 * false precision.
 */
function computeConfidence(outcome: {
  status: ResearchProviderStatus;
  data: unknown;
  citations?: unknown[];
  evidence?: unknown[];
  attempt: number;
}): number {
  if (outcome.status === "failed") return 0;

  const dataSource = (outcome.data as { dataSource?: string } | null)?.dataSource;
  const isFallback = dataSource === NO_SEARCH_DATA_SOURCE || dataSource === NO_CITATIONS_DATA_SOURCE;

  let score = outcome.status === "success" ? 0.6 : 0.3;
  if (isFallback) score -= 0.25;

  const evidenceCount = Math.max(outcome.evidence?.length ?? 0, outcome.citations?.length ?? 0);
  score += Math.min(evidenceCount * 0.04, 0.3);

  if (outcome.attempt > 1) score -= 0.1;

  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

/**
 * Every provider's execute() delegates its actual work to this wrapper so timing,
 * attempt-number bookkeeping, confidence scoring, and the "an unexpected throw becomes a
 * failed ProviderResult rather than an unhandled rejection" contract live in exactly one
 * place instead of being reimplemented 9 times.
 */
export async function runProviderStep<T>(
  name: string,
  attempt: number,
  fn: () => Promise<ProviderOutcome<T>>
): Promise<ProviderResult<T>> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const outcome = await fn();
    return {
      provider: name,
      status: outcome.status,
      data: outcome.data,
      citations: outcome.citations ?? [],
      evidence: outcome.evidence ?? [],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      attempt,
      error: outcome.error,
      confidence: computeConfidence({ status: outcome.status, data: outcome.data, citations: outcome.citations, evidence: outcome.evidence, attempt }),
    };
  } catch (err) {
    return {
      provider: name,
      status: "failed",
      data: null,
      citations: [],
      evidence: [],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      attempt,
      error: err instanceof Error ? err.message : String(err),
      confidence: 0,
    };
  }
}

/** Races a provider call against a hard deadline so one hung network call can't stall the
 * whole parallel batch indefinitely — the orchestrator's per-provider retry then treats a
 * timeout exactly like any other failure. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function citationsToEvidence(citations: Citation[]): ResearchEvidenceItem[] {
  return citations.map((c) => ({ url: c.url, title: c.title }));
}

/** Normalizes a bare hostname/URL the same way modules/onboarding/scraper.ts does, so
 * every provider tolerates the same loose input ("example.com" as well as "https://example.com"). */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname;
  } catch {
    return url;
  }
}

export const NO_SEARCH_DATA_SOURCE = "AI estimate — no live web search performed (OPENAI_API_KEY not set)";
export const NO_CITATIONS_DATA_SOURCE = "AI estimate based on general knowledge (no citable sources found)";

/**
 * The "live web research, then shape it into a structured schema" composition every
 * OpenAI-backed provider below needs — built on top of the existing runWebSearch/
 * runStructured primitives (infra/openaiClient.ts) rather than a new model integration.
 * Callers pass a fallback producer for the no-API-key / no-result path so each provider
 * still returns a (labeled "AI estimate") result instead of an empty one.
 */
export async function webSearchThenStructure<T extends { dataSource?: string }>(opts: {
  searchPrompt: string;
  structurePrompt: (narrative: string) => string;
  tool: JsonSchemaTool;
  maxTokens: number;
  fallback: () => T;
}): Promise<{ status: ResearchProviderStatus; data: T; citations: Citation[] }> {
  if (!openai) {
    return { status: "partial", data: { ...opts.fallback(), dataSource: NO_SEARCH_DATA_SOURCE }, citations: [] };
  }

  const research = await runWebSearch(opts.searchPrompt);
  const result = await runStructured<T>({
    maxTokens: opts.maxTokens,
    tool: opts.tool,
    messages: [{ role: "user", content: opts.structurePrompt(research.narrative || "(no live web research available — reason from general category knowledge)") }],
  });
  if (!result) {
    return { status: "partial", data: { ...opts.fallback(), dataSource: NO_SEARCH_DATA_SOURCE }, citations: [] };
  }

  const dataSource = research.citations.length > 0 ? research.citations.map((c) => c.title).join(" + ") : NO_CITATIONS_DATA_SOURCE;
  return { status: "success", data: { ...result, dataSource }, citations: research.citations };
}
