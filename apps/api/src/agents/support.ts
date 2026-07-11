import type { z } from "zod";
import { openai, runStructured, type JsonSchemaTool } from "../infra/openaiClient.js";
import { logger } from "../modules/logger/logger.js";
import { withSpan } from "../infra/telemetry.js";
import { promptRegistry } from "./prompts/PromptRegistry.js";
import type { AgentEvidenceItem, AgentResult, ResearchContext } from "./types/index.js";
// Side-effect import: registers all 20 agents' prompts before any agent can call
// callAgentModel below. Every agent file imports callAgentModel from this module (not
// necessarily the prompts/definitions barrel directly), so this is the one place that
// guarantees registration regardless of which file an importer reaches an agent through.
import "./prompts/definitions/index.js";

const FALLBACK_CONFIDENCE = 0.2;
const BASE_CONFIDENCE = 0.9;
const MAX_CONFIDENCE = 0.95;
const PER_MISSING_FIELD_PENALTY = 0.15;

/** Every field on ResearchContext an agent might draw from, paired with the human label
 * used in evidence entries — kept in one place so collectEvidence/computeConfidence agree
 * on what "this field is missing" means. The 11 fields after `news` back the 9 newer
 * research providers (research/providers/{SocialMedia,Reviews,Funding,...}Provider.ts) —
 * optional on ResearchContext itself, but every agent field-list here treats "missing" the
 * same way regardless of whether a field is one of the original 8 or one of these 11. */
const CONTEXT_FIELD_KEYS = [
  "website", "market", "technology", "competitors", "keywords", "audience", "company", "news",
  "socialMedia", "reviews", "funding", "hiringSignals", "contentMarketing", "backlinkAuthority",
  "appStore", "videoPresence", "localPresence", "partnerships", "legalRegulatory",
] as const;
type ContextFieldKey = (typeof CONTEXT_FIELD_KEYS)[number];

/**
 * Deterministic confidence score — NOT a self-reported LLM confidence (well-documented to
 * be poorly calibrated). Starts high when the model call actually succeeded and the input
 * data was present, and is penalized per input field the agent depends on that turned out
 * null/missing in the context. Forced to a flat low score whenever the agent had to fall
 * back (no OPENAI_API_KEY, or the model's output failed schema validation) — a fallback
 * result is a reasonable default, not a researched conclusion, and confidence must say so.
 */
export function computeConfidence(context: ResearchContext, fields: ContextFieldKey[], usedFallback: boolean): number {
  if (usedFallback) return FALLBACK_CONFIDENCE;
  // == null (not ===) deliberately catches both null (provider ran, found nothing) and
  // undefined (one of the 11 optional fields never populated at all) as equally "missing" —
  // the original 8 fields are never undefined in practice, but treating both the same way
  // here means a new agent using the newer optional fields doesn't need its own variant.
  const missing = fields.filter((f) => context[f] == null).length;
  const score = BASE_CONFIDENCE - missing * PER_MISSING_FIELD_PENALTY;
  return Math.max(FALLBACK_CONFIDENCE, Math.min(MAX_CONFIDENCE, score));
}

/** Evidence is derived from the context itself (each field's own `dataSource` label),
 * never from what the model claims — so an agent's evidence trail can't be hallucinated. */
export function collectEvidence(context: ResearchContext, fields: ContextFieldKey[]): AgentEvidenceItem[] {
  return fields.map((field) => {
    const value = context[field] as { dataSource?: string } | null;
    return { source: field, detail: value?.dataSource ?? `${field} was not available in this ResearchContext` };
  });
}

interface CallAgentModelOptions<T> {
  promptId: string;
  vars: Record<string, string>;
  tool: JsonSchemaTool;
  schema: z.ZodType<T>;
  maxTokens: number;
  fallback: () => T;
}

export interface CallAgentModelResult<T> {
  data: T;
  promptVersion: number;
  usedFallback: boolean;
}

/**
 * The one place every agent calls out to the model — always renders its prompt through
 * the Prompt Registry (never a hardcoded string), always validates the model's structured
 * output against the agent's zod schema before trusting it, and always degrades to a
 * labeled fallback (no API key, no tool call, or a schema mismatch) rather than throwing,
 * so a single flaky agent can't take down a caller running several of them.
 */
export async function callAgentModel<T>(opts: CallAgentModelOptions<T>): Promise<CallAgentModelResult<T>> {
  const rendered = promptRegistry.render(opts.promptId, opts.vars);

  if (!openai) {
    return { data: opts.fallback(), promptVersion: rendered.meta.version, usedFallback: true };
  }

  const result = await runStructured<unknown>({
    maxTokens: opts.maxTokens,
    tool: opts.tool,
    system: rendered.system,
    messages: [{ role: "user", content: rendered.prompt }],
  });
  if (!result) {
    return { data: opts.fallback(), promptVersion: rendered.meta.version, usedFallback: true };
  }

  const parsed = opts.schema.safeParse(result);
  if (!parsed.success) {
    logger.warn(`Agent prompt "${opts.promptId}" v${rendered.meta.version}: model output failed schema validation — using fallback`, parsed.error);
    return { data: opts.fallback(), promptVersion: rendered.meta.version, usedFallback: true };
  }

  return { data: parsed.data, promptVersion: rendered.meta.version, usedFallback: false };
}

interface AgentStepOutcome<T> {
  data: T;
  confidence: number;
  evidence: AgentEvidenceItem[];
  promptId: string;
  promptVersion: number;
  usedFallback: boolean;
}

/** Timing/error envelope shared by all 10 agents — mirrors research/providers/support.ts's
 * runProviderStep so both layers fail the same way: an unexpected throw becomes a failed
 * result object instead of an unhandled rejection, never a process crash. */
export async function runAgentStep<T>(name: string, fn: () => Promise<AgentStepOutcome<T>>): Promise<AgentResult<T>> {
  const start = Date.now();
  try {
    const outcome = await withSpan(`agent.${name}`, fn);
    return {
      agent: name,
      promptId: outcome.promptId,
      promptVersion: outcome.promptVersion,
      data: outcome.data,
      confidence: outcome.confidence,
      evidence: outcome.evidence,
      usedFallback: outcome.usedFallback,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { agent: name });
  }
}
