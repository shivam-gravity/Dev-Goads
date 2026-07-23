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

test("AgentCoordinator - runs BOTH reviewer agents (critic-agent, compliance-agent), each seeing the same producer priorResults, neither seeing the other", async () => {
  const producers = ["a", "b"].map((n) => fakeAgent(n, () => successResult(n, { n })));
  let criticSaw: string[] | undefined;
  let complianceSaw: string[] | undefined;

  const critic: AIAgent<unknown> = {
    name: "critic-agent",
    promptId: "critic-agent",
    async execute(_context, input) {
      criticSaw = Object.keys(input?.priorResults ?? {}).sort();
      return successResult("critic-agent", {});
    },
  };
  const compliance: AIAgent<unknown> = {
    name: "compliance-agent",
    promptId: "compliance-agent",
    async execute(_context, input) {
      complianceSaw = Object.keys(input?.priorResults ?? {}).sort();
      return successResult("compliance-agent", {});
    },
  };

  const pipeline = await runAgentCoordinator(fixtureContext(), { agents: [...producers, critic, compliance] });

  assert.deepStrictEqual(criticSaw, ["a", "b"], "critic must see only the producers, not compliance-agent");
  assert.deepStrictEqual(complianceSaw, ["a", "b"], "compliance must see only the producers, not critic-agent");
  assert.deepStrictEqual(Object.keys(pipeline.results).sort(), ["a", "b", "compliance-agent", "critic-agent"]);
  assert.deepStrictEqual(pipeline.order.slice(-2).sort(), ["compliance-agent", "critic-agent"], "both reviewers must run after all producers");
});

test("AgentCoordinator - explodes a composite producer's bundled result into legacy per-agent keys", async () => {
  // strategy-agent is a composite: its `data` bundle must fan out into the 4 legacy keys the
  // rest of the pipeline reads, each carrying its own sub-part of the bundle.
  const strategy = fakeAgent("strategy-agent", () =>
    successResult("strategy-agent", {
      campaign: { summary: "camp" },
      audience: { primaryAudience: "aud", personas: [{ name: "P1" }] },
      keyword: { primaryKeywords: ["k"] },
      budget: { recommendedDailyBudgetCents: 4200 },
    })
  );

  const pipeline = await runAgentCoordinator(fixtureContext(), { agents: [strategy] });

  assert.deepStrictEqual(Object.keys(pipeline.results).sort(), ["audience-agent", "budget-agent", "campaign-agent", "keyword-agent"]);
  assert.deepStrictEqual((pipeline.results["campaign-agent"].data as { summary: string }).summary, "camp");
  assert.deepStrictEqual((pipeline.results["budget-agent"].data as { recommendedDailyBudgetCents: number }).recommendedDailyBudgetCents, 4200);
  // Each exploded result re-labels agent/promptId to the legacy name (not the composite's).
  assert.strictEqual(pipeline.results["audience-agent"].agent, "audience-agent");
  assert.strictEqual(pipeline.results["audience-agent"].promptId, "audience-agent");
});

test("AgentCoordinator - composite reviewer-agent explodes into critic-agent + compliance-agent and sees exploded producer proposals", async () => {
  const strategy = fakeAgent("strategy-agent", () =>
    successResult("strategy-agent", { campaign: {}, audience: {}, keyword: {}, budget: {} })
  );
  let reviewerSaw: string[] | undefined;
  const reviewer: AIAgent<unknown> = {
    name: "reviewer-agent",
    promptId: "reviewer-agent",
    async execute(_context, input) {
      reviewerSaw = Object.keys(input?.priorResults ?? {}).sort();
      return successResult("reviewer-agent", { critic: { overallScore: 70 }, compliance: { overallRisk: "low" } });
    },
  };

  const pipeline = await runAgentCoordinator(fixtureContext(), { agents: [strategy, reviewer] });

  // The reviewer must review the EXPLODED producer proposals, not the opaque composite bundle.
  assert.deepStrictEqual(reviewerSaw, ["audience-agent", "budget-agent", "campaign-agent", "keyword-agent"]);
  assert.ok("critic-agent" in pipeline.results && "compliance-agent" in pipeline.results, "reviewer bundle must explode into both reviewers");
  assert.strictEqual((pipeline.results["critic-agent"].data as { overallScore: number }).overallScore, 70);
  assert.strictEqual((pipeline.results["compliance-agent"].data as { overallRisk: string }).overallRisk, "low");
});
