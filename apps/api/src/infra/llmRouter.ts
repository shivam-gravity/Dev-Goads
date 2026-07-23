import { logger } from "../modules/logger/logger.js";
import * as bedrockClient from "./bedrockClient.js";
import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { assertGlobalLlmUsageAvailable } from "./llmUsageBoundary.js";

/**
 * Single-provider dispatch: the whole pipeline depends FULLY on Claude via Amazon Bedrock.
 * Callers (agents/support.ts, research/providers/support.ts, research/decision/support.ts)
 * never import bedrockClient directly; they resolve an LLMAssignment via llmTaskConfig.ts and
 * call this. There is no multi-provider fallback chain any more — Bedrock is a paid, metered,
 * non-free-tier-throttled backend, so a task either succeeds on Bedrock (with the client's own
 * concurrency-cap + retry-with-backoff riding out transient 429/5xx) or returns null.
 */

export type LLMProvider = "bedrock";
export interface LLMAssignment {
  provider: LLMProvider;
  model: string;
}

interface StructuredOpts {
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}

interface TextOpts {
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
}

/** `source` reports which provider produced `data`. With a single backend it is always
 * "bedrock", but the field is kept so callers (callAgentModel, webSearchThenStructure,
 * callDecisionModel) can keep surfacing provenance on their own result types unchanged. */
export interface RunResult<T> {
  data: T | null;
  source: LLMProvider;
}

export async function runStructured<T>(assignment: LLMAssignment, opts: StructuredOpts): Promise<RunResult<T>> {
  // Checked before dispatch — see llmUsageBoundary.ts for why this is a hard stop.
  assertGlobalLlmUsageAvailable();
  try {
    const data = await bedrockClient.runStructured<T>({ ...opts, model: assignment.model });
    return { data, source: "bedrock" };
  } catch (err) {
    logger.warn(`llmRouter: bedrock:${assignment.model} structured call failed`, err);
    return { data: null, source: "bedrock" };
  }
}

export async function runText(assignment: LLMAssignment, opts: TextOpts): Promise<RunResult<string>> {
  assertGlobalLlmUsageAvailable();
  try {
    const data = await bedrockClient.runText({ ...opts, model: assignment.model });
    return { data, source: "bedrock" };
  } catch (err) {
    logger.warn(`llmRouter: bedrock:${assignment.model} text call failed`, err);
    return { data: null, source: "bedrock" };
  }
}
