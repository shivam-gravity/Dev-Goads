import { test, after } from "node:test";
import assert from "node:assert";
import { createStrategyFromAgentResults } from "../modules/strategy/strategyEngine.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";
import type { CampaignAgentOutput } from "../agents/types/index.js";
import type { DecisionContext } from "../research/decision/types.js";

after(disconnectTestInfra);

function fakeAgentOutput(creativeCount: number): CampaignAgentOutput {
  return {
    summary: "A test strategy",
    recommendedNetworks: ["meta"],
    budgetSplit: { meta: 1 },
    audiences: ["Everyone"],
    creatives: Array.from({ length: creativeCount }, (_, i) => ({
      headline: `Creative ${i + 1}`,
      body: `Body for creative ${i + 1}`,
      callToAction: "Learn More",
    })),
  };
}

function fakeDecisionContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    businessSummary: "A test business.", audiencePersonas: [], topOpportunities: [], topRisks: [],
    pricingTiers: [], notableCustomers: [], quantifiedProofPoints: [], regionalMarketDepth: null,
    recommendedPositioning: "n/a", recommendedAudiencePriority: "n/a", recommendedChannels: [],
    recommendedBudgetAllocation: {}, recommendedDailyBudgetCents: 0, budgetReasoning: [],
    recommendedCreativeDirection: "n/a", recommendedOffer: "n/a",
    recommendedMessaging: "n/a", confidence: 0.5, evidence: [], tradeoffs: [],
    recommendations: [], tradeoffAnalyses: [], explainability: [], strategies: [], simulations: [],
    generatedAt: "now",
    ...overrides,
  };
}

test("createStrategyFromAgentResults - pads through to at least 8 creatives when the model returns fewer", async () => {
  const strategy = await createStrategyFromAgentResults(`biz_pad_${Date.now()}`, fakeAgentOutput(3));
  assert.ok(strategy.creatives.length >= 8, `expected >= 8 creatives, got ${strategy.creatives.length}`);
});

test("createStrategyFromAgentResults - every creative (including padded ones) has a unique headline", async () => {
  const strategy = await createStrategyFromAgentResults(`biz_pad_${Date.now()}`, fakeAgentOutput(2));
  const headlines = strategy.creatives.map((c) => c.headline);
  assert.strictEqual(new Set(headlines).size, headlines.length, "expected every headline to be unique");
});

test("createStrategyFromAgentResults - does not pad when the model already returned enough creatives", async () => {
  const strategy = await createStrategyFromAgentResults(`biz_pad_${Date.now()}`, fakeAgentOutput(10));
  assert.strictEqual(strategy.creatives.length, 10);
});

test("createStrategyFromAgentResults - falls back to the agent's own budget/networks when no decisionContext is passed", async () => {
  const agentOutput = fakeAgentOutput(8);
  agentOutput.budgetSplit = { meta: 0.7, google: 0.3 };
  agentOutput.recommendedNetworks = ["meta", "google"];

  const strategy = await createStrategyFromAgentResults(`biz_no_decision_${Date.now()}`, agentOutput);
  assert.deepStrictEqual(strategy.budgetSplit, { meta: 0.7, google: 0.3 });
  assert.deepStrictEqual(strategy.recommendedNetworks, ["meta", "google"]);
});

test("createStrategyFromAgentResults - the Decision Engine's ranked/simulated budget allocation overrides the agent's own budgetSplit and networks", async () => {
  const agentOutput = fakeAgentOutput(8);
  agentOutput.budgetSplit = { meta: 1 };
  agentOutput.recommendedNetworks = ["meta"];

  const decisionContext = fakeDecisionContext({
    recommendedBudgetAllocation: { google: 0.6, tiktok: 0.4 },
  });

  const strategy = await createStrategyFromAgentResults(`biz_decision_${Date.now()}`, agentOutput, decisionContext);

  assert.deepStrictEqual(
    strategy.budgetSplit,
    { google: 0.6, tiktok: 0.4 },
    "the Decision Engine's simulated allocation must win over the agent's own single-pass guess"
  );
  assert.deepStrictEqual(
    strategy.recommendedNetworks.slice().sort(),
    ["google", "tiktok"],
    "recommendedNetworks must match the Decision Engine's channels, not the agent's (meta)"
  );
});

test("createStrategyFromAgentResults - the Decision Engine's audience priority leads the audience list, without dropping the agent's own audiences", async () => {
  const agentOutput = fakeAgentOutput(8);
  agentOutput.audiences = ["Existing customers", "Lookalike 1%"];

  const decisionContext = fakeDecisionContext({ recommendedAudiencePriority: "High-intent cart abandoners" });

  const strategy = await createStrategyFromAgentResults(`biz_audience_${Date.now()}`, agentOutput, decisionContext);

  assert.strictEqual(strategy.audiences[0], "High-intent cart abandoners");
  assert.ok(strategy.audiences.includes("Existing customers"));
  assert.ok(strategy.audiences.includes("Lookalike 1%"));
});

test("createStrategyFromAgentResults - a decisionContext with an empty budget allocation (e.g. Decision Engine failed) doesn't override the agent's real numbers", async () => {
  const agentOutput = fakeAgentOutput(8);
  agentOutput.budgetSplit = { meta: 0.5, google: 0.5 };

  const decisionContext = fakeDecisionContext({ recommendedBudgetAllocation: {} });
  const strategy = await createStrategyFromAgentResults(`biz_empty_decision_${Date.now()}`, agentOutput, decisionContext);

  assert.deepStrictEqual(strategy.budgetSplit, { meta: 0.5, google: 0.5 });
});
