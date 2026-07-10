import { test } from "node:test";
import assert from "node:assert";
import { runAgentCoordinator } from "../agents/AgentCoordinator.js";
import type { AIAgent } from "../agents/interfaces/AIAgent.js";
import type { AgentExecuteInput, AgentResult } from "../agents/types/index.js";
import type { ResearchContext } from "../research/types/index.js";

function fixtureContext(): ResearchContext {
  return {
    jobId: "job-1",
    workspaceId: "ws-1",
    url: "https://example.com",
    website: null,
    market: null,
    technology: null,
    competitors: null,
    keywords: null,
    audience: null,
    company: null,
    news: null,
    metadata: { jobId: "job-1", generatedAt: "now", totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
  };
}

function successResult(name: string, data: unknown = {}): AgentResult<unknown> {
  return {
    agent: name,
    promptId: name,
    promptVersion: 1,
    data,
    confidence: 0.9,
    evidence: [],
    usedFallback: false,
    generatedAt: new Date().toISOString(),
    durationMs: 1,
  };
}

/** A fake AIAgent whose behavior per call attempt is fully controlled by the test —
 * `behavior(attempt)` returns either a real AgentResult or the literal "throw" to
 * simulate the unexpected-failure path runAgentWithRetry is meant to retry. */
function fakeAgent(name: string, behavior: (attempt: number) => AgentResult<unknown> | "throw"): AIAgent<unknown> {
  let calls = 0;
  return {
    name,
    promptId: name,
    async execute(_context: ResearchContext, _input?: AgentExecuteInput) {
      calls += 1;
      const outcome = behavior(calls);
      if (outcome === "throw") throw new Error(`${name} failed (attempt ${calls})`);
      return outcome;
    },
  };
}

test("AgentCoordinator - runs producer agents in parallel and Critic last with their results as priorResults", async () => {
  const producers = ["a", "b", "c"].map((n) => fakeAgent(n, () => successResult(n, { n })));
  let criticReceivedPriorResults: Record<string, AgentResult<unknown>> | undefined;
  const critic: AIAgent<unknown> = {
    name: "critic-agent",
    promptId: "critic-agent",
    async execute(_context, input) {
      criticReceivedPriorResults = input?.priorResults;
      return successResult("critic-agent", { reviewed: Object.keys(input?.priorResults ?? {}) });
    },
  };

  const progressCalls: Array<[number, number]> = [];
  const pipeline = await runAgentCoordinator(fixtureContext(), {
    agents: [...producers, critic],
    onProgress: async (c, t) => {
      progressCalls.push([c, t]);
    },
  });

  assert.deepStrictEqual(Object.keys(pipeline.results).sort(), ["a", "b", "c", "critic-agent"]);
  assert.deepStrictEqual(pipeline.order, ["a", "b", "c", "critic-agent"]);
  assert.deepStrictEqual(Object.keys(criticReceivedPriorResults ?? {}).sort(), ["a", "b", "c"], "Critic must see exactly the 9 (here 3) producer results, not itself");
  assert.strictEqual(progressCalls.length, 4, "one progress callback per agent, including Critic");
  assert.deepStrictEqual(progressCalls[progressCalls.length - 1], [4, 4]);
});

test("AgentCoordinator - retries an agent that throws once before succeeding, same shape as ResearchOrchestrator's provider retry", async () => {
  const flaky = fakeAgent("flaky", (attempt) => (attempt === 1 ? "throw" : successResult("flaky", { recovered: true })));
  const critic = fakeAgent("critic-agent", () => successResult("critic-agent", {}));

  const pipeline = await runAgentCoordinator(fixtureContext(), { agents: [flaky, critic] });

  assert.strictEqual((pipeline.results["flaky"].data as { recovered: boolean }).recovered, true);
});

test("AgentCoordinator - an agent that fails every attempt rejects the whole run rather than silently dropping it", async () => {
  const alwaysThrows = fakeAgent("broken", () => "throw");
  const critic = fakeAgent("critic-agent", () => successResult("critic-agent", {}));

  await assert.rejects(() => runAgentCoordinator(fixtureContext(), { agents: [alwaysThrows, critic] }), /broken failed/);
});

test("AgentCoordinator - Critic is optional; a run with no critic-agent present still completes", async () => {
  const solo = fakeAgent("solo", () => successResult("solo", {}));

  const pipeline = await runAgentCoordinator(fixtureContext(), { agents: [solo] });

  assert.deepStrictEqual(pipeline.order, ["solo"]);
  assert.ok(!("critic-agent" in pipeline.results));
});
