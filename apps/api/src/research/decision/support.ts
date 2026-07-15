import * as llmRouter from "../../infra/llmRouter.js";
import { resolveTaskModel } from "../../infra/llmTaskConfig.js";
import { logger } from "../../modules/logger/logger.js";
import type { ChatMessage, JsonSchemaTool } from "../../infra/llmTypes.js";

export interface CallDecisionModelOptions {
  /** Keys into llmTaskConfig.ts's registry — one per Decision Engine step, e.g.
   * "decision-summary", "recommendation-generation", "tradeoff-analysis",
   * "strategy-synthesis", "enrichment-proof-points", "enrichment-regional-depth". */
  taskName: string;
  maxTokens: number;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}

/**
 * The Decision Engine's equivalent of agents/support.ts's callAgentModel — the one
 * chokepoint every one of its 5 sub-engines' model calls routes through, so per-task model
 * assignment (llmTaskConfig.ts) applies here too. Every Decision Engine call site already
 * has its own `structured ?? fallbackX()` handling inline (a pre-existing convention, kept
 * as-is rather than forced into callAgentModel's schema/fallback-callback shape) — this
 * wrapper's only job is model routing plus "never throw": returns null (not a thrown
 * error) on any failure, so every existing `?? fallback()` call site keeps working exactly
 * as before, just resolving its model per-task instead of always OpenAI.
 */
export async function callDecisionModel<T>(opts: CallDecisionModelOptions): Promise<T | null> {
  const assignment = resolveTaskModel(opts.taskName);
  try {
    const { data } = await llmRouter.runStructured<T>(assignment, {
      maxTokens: opts.maxTokens,
      tool: opts.tool,
      messages: opts.messages,
    });
    return data;
  } catch (err) {
    logger.warn(`Decision Engine task "${opts.taskName}": model call failed`, err);
    return null;
  }
}
