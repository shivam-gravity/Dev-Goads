import { logger } from "../../modules/logger/logger.js";
import { aggregateResearch } from "../knowledge/KnowledgeAggregator.js";
import { getBusiness } from "../../modules/business/businessService.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import { ResearchJobStateMachine } from "../state-machine/ResearchJobStateMachine.js";
import { createResearchProviders } from "../providers/index.js";
import { withTimeout } from "../providers/support.js";
import type { ProviderResult, ResearchContext, ResearchJobStatus, ResearchProviderInput } from "../types/index.js";
import {
  createResearchSnapshot,
  getResearchJob,
  markResearchJobCompleted,
  markResearchJobStatus,
  recordProviderExecution,
  type ResearchJobRecord,
} from "./researchJobService.js";

export const MAX_PROVIDER_ATTEMPTS = 2;
export const PROVIDER_RETRY_DELAY_MS = 1000;
export const PROVIDER_TIMEOUT_MS = 45_000;

/** Persistence + reporting hooks the orchestrator calls out to — real implementations
 * (defaultDeps below) hit Postgres via researchJobService; unit tests inject in-memory
 * fakes instead, so orchestration logic (parallel fan-out, retry, aggregation, state
 * transitions) is fully testable without a database. */
export interface OrchestratorDeps {
  loadJob(jobId: string): Promise<ResearchJobRecord | null>;
  markStatus(jobId: string, status: ResearchJobStatus, extra?: { startedAt?: boolean; completedAt?: boolean; error?: string }): Promise<void>;
  recordExecution(jobId: string, result: ProviderResult<unknown>): Promise<void>;
  persistSnapshot(jobId: string, context: ResearchContext): Promise<void>;
  persistCompleted(jobId: string, context: ResearchContext): Promise<void>;
  /** Resolves the Business record's real name for `ResearchProviderInput.businessName` —
   * optional so existing test fakes that don't provide it keep compiling; omission just
   * means every provider falls back to its current hostname-derived query, same as today. */
  loadBusinessName?(businessId: string): Promise<string | undefined>;
}

/** Never throws — a Business lookup failure (bad id, transient DB blip) degrades to
 * `undefined`, which every provider already treats as "derive a name from the hostname
 * instead", the same fail-soft contract every other provider-facing lookup in this file
 * follows (see recordExecution's `.catch` below). */
async function loadBusinessName(businessId: string): Promise<string | undefined> {
  try {
    const business = await getBusiness(businessId);
    return business?.name;
  } catch (err) {
    logger.warn(`Failed to load Business ${businessId} for research context — providers will fall back to hostname-derived name`, err);
    return undefined;
  }
}

export const defaultOrchestratorDeps: OrchestratorDeps = {
  loadJob: getResearchJob,
  markStatus: markResearchJobStatus,
  recordExecution: recordProviderExecution,
  persistSnapshot: createResearchSnapshot,
  persistCompleted: markResearchJobCompleted,
  loadBusinessName,
};

export interface RunResearchOrchestratorOptions {
  providers?: ResearchProvider<unknown>[];
  deps?: OrchestratorDeps;
  /** Called once per provider settlement (including retries) with (completedCount, totalCount,
   * providerName) — the worker wires this to BullMQ's job.updateProgress (the count) and to a
   * live-progress Redis record (the name), so the UI can show real step names as they complete
   * instead of a generic percentage. `providerName` is the just-settled provider's `name`, not a
   * cumulative list — callers accumulate it themselves (see workers/researchOrchestratorWorker.ts). */
  onProgress?: (completed: number, total: number, providerName?: string) => void | Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one provider to completion, retrying up to MAX_PROVIDER_ATTEMPTS times if it comes
 * back "failed" (a "partial" result is NOT retried — the provider ran successfully and
 * made a considered judgment call to report partial data, e.g. no OPENAI_API_KEY, and
 * retrying would just waste time reproducing the same partial result). Every attempt
 * (not just the last) is persisted via deps.recordExecution, so ProviderExecution's audit
 * trail shows exactly how many tries each provider needed. Independent of every other
 * provider's retry loop — a flaky provider retrying never blocks or delays the others,
 * since the orchestrator below fans all of these out concurrently.
 */
async function runProviderWithRetry(
  provider: ResearchProvider<unknown>,
  input: ResearchProviderInput,
  deps: OrchestratorDeps
): Promise<ProviderResult<unknown>> {
  let lastResult: ProviderResult<unknown> | undefined;

  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt++) {
    const startedAt = new Date().toISOString();
    let result: ProviderResult<unknown>;
    try {
      result = await withTimeout(provider.execute(input), PROVIDER_TIMEOUT_MS, `${provider.name} provider`);
      result = { ...result, attempt };
    } catch (err) {
      result = {
        provider: provider.name,
        status: "failed",
        data: null,
        citations: [],
        evidence: [],
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(startedAt).getTime(),
        attempt,
        error: err instanceof Error ? err.message : String(err),
        confidence: 0,
      };
    }

    lastResult = result;
    await deps.recordExecution(input.jobId, result).catch((err) => logger.warn(`Failed to persist ProviderExecution for ${provider.name}`, err));

    if (result.status !== "failed") return result;
    if (attempt < MAX_PROVIDER_ATTEMPTS) {
      logger.warn(`Provider ${provider.name} failed on attempt ${attempt}/${MAX_PROVIDER_ATTEMPTS} for job ${input.jobId} — retrying`, result.error);
      await sleep(PROVIDER_RETRY_DELAY_MS * attempt);
    }
  }

  return lastResult!;
}

/**
 * The Research Orchestrator's core entrypoint — called by the BullMQ worker (see
 * workers/researchOrchestratorWorker.ts) with just a jobId. Responsibilities per the
 * spec: create/track the job (createResearchJob in researchJobService.ts handles
 * creation; this handles tracking), execute all providers in parallel, retry failures,
 * aggregate results, persist research, and return the strongly-typed ResearchContext.
 */
export async function runResearchOrchestrator(jobId: string, options: RunResearchOrchestratorOptions = {}): Promise<ResearchContext> {
  const deps = options.deps ?? defaultOrchestratorDeps;
  const providers = options.providers ?? (createResearchProviders() as ResearchProvider<unknown>[]);

  const job = await deps.loadJob(jobId);
  if (!job) throw new Error(`Research job ${jobId} not found`);

  const state = new ResearchJobStateMachine(job.status);

  try {
    state.transition("running");
    await deps.markStatus(jobId, state.state, { startedAt: true });

    const businessName = job.businessId ? await deps.loadBusinessName?.(job.businessId) : undefined;

    const input: ResearchProviderInput = {
      jobId,
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      url: job.url,
      businessName,
    };

    let completed = 0;
    const results = await Promise.all(
      providers.map(async (provider) => {
        const result = await runProviderWithRetry(provider, input, deps);
        completed += 1;
        await options.onProgress?.(completed, providers.length, provider.name);
        return result;
      })
    );

    state.transition("aggregating");
    await deps.markStatus(jobId, state.state);

    const context = aggregateResearch({
      jobId,
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      url: job.url,
      results,
    });

    await deps.persistSnapshot(jobId, context);

    state.transition("completed");
    await deps.persistCompleted(jobId, context);

    return context;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Research orchestration failed";
    if (state.canTransitionTo("failed")) {
      state.transition("failed");
      await deps.markStatus(jobId, "failed", { completedAt: true, error: message }).catch((persistErr) => logger.error(`Failed to persist failure for job ${jobId}`, persistErr));
    }
    throw err;
  }
}
