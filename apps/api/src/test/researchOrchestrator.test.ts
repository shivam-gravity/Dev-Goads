import { test } from "node:test";
import assert from "node:assert";
import { runResearchOrchestrator, type OrchestratorDeps } from "../research/research-orchestrator/ResearchOrchestrator.js";
import type { ResearchJobRecord } from "../research/research-orchestrator/researchJobService.js";
import type { ResearchProvider } from "../research/interfaces/ResearchProvider.js";
import type { ProviderResult, ResearchContext, ResearchJobStatus, ResearchProviderInput } from "../research/types/index.js";

function fakeJob(overrides: Partial<ResearchJobRecord> = {}): ResearchJobRecord {
  const now = new Date().toISOString();
  return {
    id: "job-1", workspaceId: "ws-1", businessId: "biz-1", url: "https://example.com",
    status: "pending", context: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

interface FakeDeps extends OrchestratorDeps {
  statusHistory: ResearchJobStatus[];
  executionsByProvider: Map<string, ProviderResult<unknown>[]>;
  completedContext: ResearchContext | null;
  snapshotContext: ResearchContext | null;
}

function fakeDeps(job: ResearchJobRecord): FakeDeps {
  const statusHistory: ResearchJobStatus[] = [];
  const executionsByProvider = new Map<string, ProviderResult<unknown>[]>();
  let completedContext: ResearchContext | null = null;
  let snapshotContext: ResearchContext | null = null;

  return {
    statusHistory,
    executionsByProvider,
    get completedContext() { return completedContext; },
    get snapshotContext() { return snapshotContext; },
    async loadJob() { return job; },
    async markStatus(_jobId, status) { statusHistory.push(status); },
    async recordExecution(_jobId, result) {
      const list = executionsByProvider.get(result.provider) ?? [];
      list.push(result);
      executionsByProvider.set(result.provider, list);
    },
    async persistSnapshot(_jobId, context) { snapshotContext = context; },
    async persistCompleted(_jobId, context) { completedContext = context; },
  } as FakeDeps;
}

function succeedingProvider(name: string, priority = 10): ResearchProvider<unknown> {
  return {
    name,
    priority,
    async execute(_input: ResearchProviderInput): Promise<ProviderResult<unknown>> {
      const now = new Date().toISOString();
      return { provider: name, status: "success", data: { ok: true }, citations: [], evidence: [], startedAt: now, completedAt: now, durationMs: 1, attempt: 1, confidence: 1 };
    },
  };
}

/** Fails on its first N calls, then succeeds — used to prove per-provider retry works. */
function flakyProvider(name: string, failuresBeforeSuccess: number): ResearchProvider<unknown> {
  let calls = 0;
  return {
    name,
    priority: 10,
    async execute(_input: ResearchProviderInput): Promise<ProviderResult<unknown>> {
      calls += 1;
      const now = new Date().toISOString();
      if (calls <= failuresBeforeSuccess) {
        return { provider: name, status: "failed", data: null, citations: [], evidence: [], startedAt: now, completedAt: now, durationMs: 1, attempt: calls, error: "boom", confidence: 0 };
      }
      return { provider: name, status: "success", data: { ok: true }, citations: [], evidence: [], startedAt: now, completedAt: now, durationMs: 1, attempt: calls, confidence: 1 };
    },
  };
}

test("ResearchOrchestrator - runs all providers in parallel and completes with an aggregated context", async () => {
  const job = fakeJob();
  const deps = fakeDeps(job);
  const providers = [succeedingProvider("website"), succeedingProvider("company"), succeedingProvider("market")];

  const progressCalls: Array<[number, number]> = [];
  const context = await runResearchOrchestrator("job-1", { providers, deps, onProgress: async (c, t) => { progressCalls.push([c, t]); } });

  assert.strictEqual(context.jobId, "job-1");
  // "completed" is persisted via deps.persistCompleted, not deps.markStatus (see
  // ResearchOrchestrator.ts) — markStatus only ever sees the non-terminal transitions.
  assert.deepStrictEqual(deps.statusHistory, ["running", "aggregating"]);
  assert.strictEqual(deps.completedContext?.jobId, "job-1");
  assert.strictEqual(deps.snapshotContext?.jobId, "job-1");
  assert.strictEqual(progressCalls.length, 3, "one progress callback per provider");
  assert.deepStrictEqual(progressCalls[progressCalls.length - 1], [3, 3]);
  for (const name of ["website", "company", "market"]) {
    assert.strictEqual(deps.executionsByProvider.get(name)?.length, 1, `${name} should have exactly one recorded execution`);
  }
});

test("ResearchOrchestrator - retries a failing provider up to MAX_PROVIDER_ATTEMPTS and records every attempt", async () => {
  const job = fakeJob();
  const deps = fakeDeps(job);
  const providers = [flakyProvider("market", 1), succeedingProvider("company")];

  const context = await runResearchOrchestrator("job-1", { providers, deps });

  // Both providers' *last* attempt reported "success" (retry recovered market), so both
  // land in providersSucceeded — status tracking reflects execution outcome, independent
  // of whether the aggregator could also validate the (here, deliberately fake) payload
  // shape. context.market itself is still null since { ok: true } doesn't match marketSchema.
  assert.deepStrictEqual(context.metadata.providersSucceeded.sort(), ["company", "market"]);
  assert.strictEqual(context.market, null);
  const marketExecutions = deps.executionsByProvider.get("market") ?? [];
  assert.strictEqual(marketExecutions.length, 2, "should retry once after the first failure");
  assert.strictEqual(marketExecutions[0].status, "failed");
  assert.strictEqual(marketExecutions[1].status, "success");
});

test("ResearchOrchestrator - a provider that fails every attempt still lets the job complete (partial results are OK)", async () => {
  const job = fakeJob();
  const deps = fakeDeps(job);
  const providers = [flakyProvider("market", 99), succeedingProvider("company")];

  const context = await runResearchOrchestrator("job-1", { providers, deps });

  assert.strictEqual(deps.statusHistory.at(-1), "aggregating");
  assert.strictEqual(deps.completedContext?.jobId, "job-1", "job should still reach persistCompleted despite one provider failing outright");
  assert.ok(context.metadata.providersFailed.includes("market"));
  assert.ok(context.metadata.providersSucceeded.includes("company"));
});

test("ResearchOrchestrator - throws and marks the job failed when the job cannot be loaded", async () => {
  const deps: OrchestratorDeps = {
    async loadJob() { return null; },
    async markStatus() {},
    async recordExecution() {},
    async persistSnapshot() {},
    async persistCompleted() {},
  };

  await assert.rejects(() => runResearchOrchestrator("missing-job", { providers: [], deps }), /not found/);
});

test("ResearchOrchestrator - an unexpected aggregation error transitions the job to failed and rethrows", async () => {
  const job = fakeJob();
  const statusHistory: ResearchJobStatus[] = [];
  const deps: OrchestratorDeps = {
    async loadJob() { return job; },
    async markStatus(_jobId, status) { statusHistory.push(status); },
    async recordExecution() {},
    async persistSnapshot() { throw new Error("db unavailable"); },
    async persistCompleted() {},
  };

  await assert.rejects(() => runResearchOrchestrator("job-1", { providers: [succeedingProvider("website")], deps }), /db unavailable/);
  assert.deepStrictEqual(statusHistory, ["running", "aggregating", "failed"]);
});
