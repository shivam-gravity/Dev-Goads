import { test, after } from "node:test";
import assert from "node:assert";
import { createStrategyFromAgentResults } from "../modules/strategy/strategyEngine.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";
import type { CampaignAgentOutput } from "../agents/types/index.js";

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
