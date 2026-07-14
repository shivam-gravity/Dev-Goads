import { AsyncLocalStorage } from "node:async_hooks";
import { openai, runWebSearch, type JsonSchemaTool } from "../../infra/openaiClient.js";
import * as llmRouter from "../../infra/llmRouter.js";
import { resolveTaskModel } from "../../infra/llmTaskConfig.js";
import { withSpan } from "../../infra/telemetry.js";
import type { Citation } from "../../types/index.js";
import type { ProviderResult, ResearchEvidenceItem, ResearchProviderStatus } from "../types/index.js";

// Carries the currently-executing provider's name across the async chain from
// runProviderStep down into webSearchThenStructure, without threading a parameter through
// every one of the ~27 providers that call it — runProviderStep (below) is already the one
// wrapper every provider's execute() calls with its own name, so stamping it here once is
// enough for the whole layer.
const currentProviderName = new AsyncLocalStorage<string>();

interface ProviderOutcome<T> {
  status: ResearchProviderStatus;
  data: T | null;
  citations?: Citation[];
  evidence?: ResearchEvidenceItem[];
  error?: string;
}

// Excluded from the word-level fallback in isRelevantCitation below — generic enough (legal
// suffixes, filler words) that matching on them alone would call almost any citation "relevant."
const CITATION_KEYWORD_FILLER_WORDS = new Set(["the", "demo", "inc", "llc", "ltd", "co", "corp", "corporation", "company"]);

/**
 * A citation counts as "relevant" if it's actually traceable to the target business —
 * either it's hosted on the target's own domain, or its title namedrops the target (by
 * businessName if given, else the hostname's own name, e.g. "stripe" from "stripe.com").
 * Deliberately cheap (no extra model call) and generic (every provider already has
 * target.url in scope) rather than exhaustive: a real roundup article ("Top Stripe
 * Alternatives") passes; a citation that never mentions the target at all doesn't. The
 * known failure mode this exists to catch: a web search for a target that doesn't
 * actually have citable coverage can still return SOME unrelated citation, which the old
 * count-only heuristic scored as if it were real grounding — see isRelevantCitation's
 * caller below for how that's now penalized rather than rewarded.
 */
export function isRelevantCitation(citation: { url?: string; title?: string }, target: { url: string; businessName?: string }): boolean {
  const targetHost = hostnameOf(target.url).replace(/^www\./i, "").toLowerCase();
  const keyword = (target.businessName ?? targetHost.split(".")[0]).toLowerCase().trim();
  const citationHost = citation.url ? hostnameOf(citation.url).replace(/^www\./i, "").toLowerCase() : "";
  const title = (citation.title ?? "").toLowerCase();

  if (citationHost && citationHost === targetHost) return true;
  if (keyword.length >= 3 && title.includes(keyword)) return true;

  // Full-phrase match above is the strongest signal, but a multi-word businessName
  // ("Polluxa Demo Business") rarely appears verbatim in a citation title ("Polluxa |
  // LinkedIn") — fall back to matching any significant word from it, so a real business
  // isn't scored as "no relevant citations" just for having a longer name than what
  // sources actually call it.
  const significantWords = keyword.split(/\s+/).filter((word) => word.length >= 3 && !CITATION_KEYWORD_FILLER_WORDS.has(word));
  if (significantWords.some((word) => title.includes(word))) return true;

  return false;
}

/**
 * Generic 0-1 confidence score computed from signals every provider already reports —
 * deliberately provider-agnostic (no provider-specific branching) so a 10th provider gets
 * scoring for free. Reads `data.dataSource` opportunistically (every provider's data shape
 * includes it by convention, see research/types/index.ts) purely to detect the two known
 * "no real live data" fallback strings — anything else (a real citation-title join, a
 * deterministic signature-detection source, etc.) is treated as real grounding, UNLESS the
 * citations themselves don't check out (see below).
 *   - failed                          -> 0
 *   - base: success 0.6, partial 0.3
 *   - -0.25 if data came from a no-live-data fallback (no OPENAI_API_KEY, or a search
 *     that returned no citable sources)
 *   - -0.25 if it's NOT a labeled fallback but has citations, and NONE of them are
 *     relevant to the target (see isRelevantCitation) — a "success" dressed up with an
 *     unrelated source is functionally the same as having no real grounding, and scoring
 *     it as if the citation count alone proved something was exactly the bug this
 *     replaced: a fabricated result with one spurious citation used to outscore an honest,
 *     labeled fallback.
 *   - up to +0.3 for evidence/citations, weighted by relevance (0.06/relevant item,
 *     0.01/irrelevant item, diminishing via the cap) — quality over quantity, so 8+ real
 *     sources top out rather than scoring above a single-source one, and a pile of
 *     irrelevant citations can't out-earn one relevant one.
 *   - -0.1 if it needed a retry (attempt > 1) — it got there, but wasn't stable on try 1
 * Clamped to [0, 1] and rounded to 2 decimals so persisted/displayed values don't carry
 * false precision.
 */
function computeConfidence(
  outcome: {
    status: ResearchProviderStatus;
    data: unknown;
    citations?: unknown[];
    evidence?: unknown[];
    attempt: number;
  },
  target: { url: string; businessName?: string }
): number {
  if (outcome.status === "failed") return 0;

  const dataSource = (outcome.data as { dataSource?: string } | null)?.dataSource;
  const isFallback = dataSource === NO_SEARCH_DATA_SOURCE || dataSource === NO_CITATIONS_DATA_SOURCE;

  let score = outcome.status === "success" ? 0.6 : 0.3;
  if (isFallback) score -= 0.25;

  const citations = (outcome.citations?.length ? outcome.citations : outcome.evidence ?? []) as { url?: string; title?: string }[];
  const relevantCount = citations.filter((c) => isRelevantCitation(c, target)).length;

  if (!isFallback && citations.length > 0 && relevantCount === 0) {
    score -= 0.25;
  }

  score += Math.min(relevantCount * 0.06 + (citations.length - relevantCount) * 0.01, 0.3);

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
  target: { url: string; businessName?: string },
  fn: () => Promise<ProviderOutcome<T>>
): Promise<ProviderResult<T>> {
  return currentProviderName.run(name, async () => {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    try {
      const outcome = await withSpan(`research.provider.${name}`, fn, { "research.provider.attempt": attempt });
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
        confidence: computeConfidence({ status: outcome.status, data: outcome.data, citations: outcome.citations, evidence: outcome.evidence, attempt }, target),
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
  });
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

  // runWebSearch itself has no non-OpenAI equivalent (it's OpenAI's hosted server-side
  // search, not a model capability) and stays OpenAI-only regardless of task assignment —
  // only the structuring step below is routed per-task.
  const research = await runWebSearch(opts.searchPrompt);
  const taskName = currentProviderName.getStore() ?? "unknown-provider";
  const assignment = resolveTaskModel(taskName);
  const { data: result, source } = await llmRouter.runStructured<T>(assignment, {
    maxTokens: opts.maxTokens,
    tool: opts.tool,
    messages: [{ role: "user", content: opts.structurePrompt(research.narrative || "(no live web research available — reason from general category knowledge)") }],
  });
  if (!result) {
    return { status: "partial", data: { ...opts.fallback(), dataSource: NO_SEARCH_DATA_SOURCE }, citations: [] };
  }

  const citationLabel = research.citations.length > 0 ? research.citations.map((c) => c.title).join(" + ") : NO_CITATIONS_DATA_SOURCE;
  // Only annotate the label when a non-default provider actually served the structuring
  // step — keeps the default (openai) path's dataSource string byte-for-byte identical to
  // today's, so nothing that asserts on it needs to change unless a task is reassigned.
  const dataSource = source === "openai" ? citationLabel : `${citationLabel} (structured via ${source}:${assignment.model})`;
  return { status: "success", data: { ...result, dataSource }, citations: research.citations };
}
