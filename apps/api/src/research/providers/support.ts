import { AsyncLocalStorage } from "node:async_hooks";
import { llm, runWebSearch, type JsonSchemaTool } from "../../infra/llmClient.js";
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

// Placeholder/seed tokens and legal suffixes that carry no search signal — stripped before a
// business name is used as a live search anchor, so a fixture like "Polluxa Demo Business" doesn't
// become the exact-phrase query `"Polluxa Demo Business"` (which matches nothing on the web) or seed
// a market-engine hallucination off the word "Demo". If nothing distinctive survives, callers fall
// back to the domain instead.
const NAME_NOISE_WORDS = new Set([
  "demo", "test", "sample", "example", "the", "business", "company", "inc", "llc", "ltd", "co", "corp", "corporation",
]);

/**
 * Returns the distinctive part of a business name with generic/placeholder/legal-suffix tokens
 * removed (case-insensitive, trailing punctuation ignored), or "" when nothing distinctive is left
 * (e.g. "Demo Business" -> ""). "Polluxa Demo Business" -> "Polluxa"; "Acme Inc." -> "Acme".
 */
export function sanitizeBusinessName(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => {
      const normalized = word.toLowerCase().replace(/[.,]/g, "").trim();
      return normalized.length > 0 && !NAME_NOISE_WORDS.has(normalized);
    })
    .join(" ")
    .trim();
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

export const NO_SEARCH_DATA_SOURCE = "AI estimate — live web search returned no usable results";
export const NO_CITATIONS_DATA_SOURCE = "AI estimate based on general knowledge (no citable sources found)";

const URL_FIELDS = new Set(["url", "sourceUrl"]);

/** Normalizes a URL for comparison — a model's copy of a real citation can differ from the
 * original in trivial formatting (trailing slash, etc.) even when it points at the exact
 * same resource; an exact-string match would be too brittle in the safe direction (rejecting
 * genuine matches), so this normalizes before comparing. Returns null for anything that
 * doesn't parse as a URL at all — such a value can never be "verified". */
function normalizeForComparison(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const DROP_ITEM = Symbol("drop-item");

/**
 * Guards against the structuring model inventing a plausible-looking url/sourceUrl for an
 * item it has no real citation for. The structuring call only ever sees narrative prose (plus
 * the verified-sources list appended in webSearchThenStructure below) — nothing else stops it
 * from fabricating a URL just to satisfy a schema field, and this codebase has already seen it
 * happen (a monday.com Reddit result with 3 threads all sharing the same bare, path-less
 * "https://en.reddit.com"). Walks every array field in the structured result; for any item
 * whose url/sourceUrl doesn't match a real, search-verified citation, either drops the whole
 * item ("drop-item" — right when the item is meaningless without a real source, e.g. a
 * Reddit thread IS its URL) or keeps the item and clears just the offending field(s)
 * ("null-field" — right when the rest of the item, e.g. a competitor's name/notes, is still
 * worth keeping on its own). Caller picks per opts.unverifiedUrlPolicy below.
 */
function stripUnverifiedUrls<T>(result: T, citations: Citation[], policy: "drop-item" | "null-field"): T {
  const verified = new Set(citations.map((c) => normalizeForComparison(c.url)).filter((u): u is string => u !== null));
  const isVerified = (candidate: unknown): boolean => {
    if (typeof candidate !== "string") return true; // not a url-shaped value — nothing to verify
    const normalized = normalizeForComparison(candidate);
    return normalized !== null && verified.has(normalized);
  };

  const output: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  for (const [key, value] of Object.entries(output)) {
    if (Array.isArray(value)) {
      output[key] = value
        .map((item) => {
          if (!item || typeof item !== "object") return item;
          const record = item as Record<string, unknown>;
          const unverifiedFields = Object.keys(record).filter((field) => URL_FIELDS.has(field) && !isVerified(record[field]));
          if (unverifiedFields.length === 0) return item;
          if (policy === "drop-item") return DROP_ITEM;
          const cleaned = { ...record };
          for (const field of unverifiedFields) cleaned[field] = undefined;
          return cleaned;
        })
        .filter((item) => item !== DROP_ITEM);
    } else if (URL_FIELDS.has(key) && typeof value === "string" && !isVerified(value)) {
      output[key] = undefined;
    }
  }
  return output as T;
}

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
  /** How to handle an item whose url/sourceUrl doesn't match a real, search-verified
   * citation. Defaults to "drop-item" (Reddit's behavior — a thread with no real URL is
   * meaningless). Pass "null-field" when the rest of the item still has standalone value
   * (e.g. CompetitorProvider — a competitor's name/notes are worth keeping even without a
   * verified URL). */
  unverifiedUrlPolicy?: "drop-item" | "null-field";
}): Promise<{ status: ResearchProviderStatus; data: T; citations: Citation[] }> {
  // runWebSearch itself has no non-OpenAI equivalent (it's OpenAI's hosted server-side
  // search, not a model capability) and stays OpenAI-only regardless of task assignment —
  // only the structuring step below is routed per-task. Without OPENAI_API_KEY (or on any
  // transient search failure) this degrades to an empty narrative/no citations rather than
  // skipping structuring altogether — the routed structuring call still runs on Ollama/
  // Gemini and reasons from general category knowledge, same as the "no live web research
  // available" prompt fallback below already anticipated, just previously unreachable
  // whenever OpenAI wasn't configured.
  const research = llm
    ? await runWebSearch(opts.searchPrompt).catch(() => ({ narrative: "", citations: [] as Citation[], searchesUsed: 0 }))
    : { narrative: "", citations: [] as Citation[], searchesUsed: 0 };
  const taskName = currentProviderName.getStore() ?? "unknown-provider";
  const assignment = resolveTaskModel(taskName);

  // Gives the structuring call the actual, search-verified source list — without this it only
  // ever saw narrative prose and had no way to know which (if any) URL was real, which is
  // exactly what let it fabricate one to satisfy a schema field. This is belt (prompt
  // instruction); stripUnverifiedUrls above is suspenders (hard post-hoc enforcement) — models
  // don't reliably follow prompt-only instructions, so both layers stay.
  const citationsBlock = research.citations.length > 0
    ? `\n\nVerified sources — for any url/sourceUrl field, ONLY use a URL from this exact list; if none of these genuinely matches a specific item, leave that item's url/sourceUrl out entirely rather than inventing one:\n${research.citations.map((c) => `- ${c.title}: ${c.url}`).join("\n")}`
    : `\n\n(No verified sources were found for this search — do not include any url/sourceUrl field in your response, since there is nothing real to point to.)`;

  const { data: result, source } = await llmRouter.runStructured<T>(assignment, {
    maxTokens: opts.maxTokens,
    tool: opts.tool,
    messages: [{ role: "user", content: opts.structurePrompt(research.narrative || "(no live web research available — reason from general category knowledge)") + citationsBlock }],
  });
  if (!result) {
    return { status: "partial", data: { ...opts.fallback(), dataSource: NO_SEARCH_DATA_SOURCE }, citations: [] };
  }

  const verifiedResult = stripUnverifiedUrls(result, research.citations, opts.unverifiedUrlPolicy ?? "drop-item");

  const citationLabel = research.citations.length > 0 ? research.citations.map((c) => c.title).join(" + ") : NO_CITATIONS_DATA_SOURCE;
  // Only annotate the label when a non-default provider actually served the structuring
  // step — keeps the default (llm) path's dataSource string byte-for-byte identical to
  // today's, so nothing that asserts on it needs to change unless a task is reassigned.
  const dataSource = source === "groq" ? citationLabel : `${citationLabel} (structured via ${source}:${assignment.model})`;
  return { status: "success", data: { ...verifiedResult, dataSource }, citations: research.citations };
}
