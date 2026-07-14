import { test, after } from "node:test";
import assert from "node:assert";
import { createStrategyFromAgentResults, createStrategyFromResearch, type ResearchStrategyInput } from "../modules/strategy/strategyEngine.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";
import type { CampaignAgentOutput, ComplianceAgentOutput, ObjectionHandlingAgentOutput, PricingOfferAgentOutput } from "../agents/types/index.js";
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
    recommendedMessaging: "n/a",
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] }, marketGaps: [], funnelStrategy: "n/a", mediaStrategy: "n/a",
    confidence: 0.5, evidence: [], tradeoffs: [],
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

test("createStrategyFromAgentResults - the Decision Engine's ranked/simulated budget allocation overrides the agent's own budgetSplit and networks, but Meta/Google are always both guaranteed present", async () => {
  const agentOutput = fakeAgentOutput(8);
  agentOutput.budgetSplit = { meta: 1 };
  agentOutput.recommendedNetworks = ["meta"];

  const decisionContext = fakeDecisionContext({
    recommendedBudgetAllocation: { google: 0.6, tiktok: 0.4 },
  });

  const strategy = await createStrategyFromAgentResults(`biz_decision_${Date.now()}`, agentOutput, decisionContext);

  assert.deepStrictEqual(
    strategy.recommendedNetworks.slice().sort(),
    ["google", "meta", "tiktok"],
    "the Decision Engine's channels (google/tiktok) win, but meta is always added — the campaign builder must never suggest only one network"
  );
  // google/tiktok keep their 0.6/0.4 relative weighting from the Decision Engine; meta (added
  // only to guarantee coverage) gets an even share of the remaining space, then everything
  // renormalizes to sum to 1: google 0.45, tiktok 0.3, meta 0.25.
  assert.deepStrictEqual(strategy.budgetSplit, { google: 0.45, tiktok: 0.3, meta: 0.25 });
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

test("createStrategyFromAgentResults - Meta and Google are always both suggested, even when the agent and Decision Engine only ever named one network", async () => {
  const agentOutput = fakeAgentOutput(8);
  agentOutput.budgetSplit = { google: 1 };
  agentOutput.recommendedNetworks = ["google"];

  const strategy = await createStrategyFromAgentResults(`biz_google_only_${Date.now()}`, agentOutput);

  assert.ok(strategy.recommendedNetworks.includes("meta"), "meta must always be suggested alongside whatever the agent picked");
  assert.ok(strategy.recommendedNetworks.includes("google"));
  assert.ok((strategy.budgetSplit.meta ?? 0) > 0, "meta must get a real, non-zero budget share, not just appear with 0");
  const sum = Object.values(strategy.budgetSplit).reduce((s, v) => s + (v ?? 0), 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `budgetSplit must still sum to ~1, got ${sum}`);
});

test("createStrategyFromResearch - Meta and Google are always both suggested even though marketLocation only ever names one recommendedPlatform", async () => {
  const input: ResearchStrategyInput = {
    product: { productName: "Widget Pro", category: "Widgets", summary: "A widget.", valueProposition: "Fast widgets.", keyFeatures: ["Fast"] },
    audience: { primaryAudience: "SMB owners", segments: [], painPoints: [], buyingMotivations: [] },
    competitorBudget: { competitors: [], competitionIntensity: "Moderate", differentiators: [], budgetReasoning: [], recommendedDailyBudgetCents: 5000, dataSource: "test" },
    marketLocation: { recommendedRegion: "US", alternativeRegions: [], marketTrends: "Growing", competitionLevel: "Moderate", recommendedPlatform: "google", placementRationale: "Search intent is high.", dataSource: "test" },
    personas: [],
  };

  const strategy = await createStrategyFromResearch(`biz_research_google_${Date.now()}`, input);

  assert.ok(strategy.recommendedNetworks.includes("meta"), "meta must be added even though recommendedPlatform was google-only");
  assert.ok(strategy.recommendedNetworks.includes("google"));
  const sum = Object.values(strategy.budgetSplit).reduce((s, v) => s + (v ?? 0), 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `budgetSplit must sum to ~1, got ${sum}`);
});

test("createStrategyFromAgentResults - without extras, behavior is identical to before (no compliance field, no extra creatives beyond the agent's own)", async () => {
  const strategy = await createStrategyFromAgentResults(`biz_no_extras_${Date.now()}`, fakeAgentOutput(8));
  assert.strictEqual(strategy.creatives.length, 8);
  assert.strictEqual(strategy.complianceWarning, undefined);
});

test("createStrategyFromAgentResults - PricingOfferAgent's recommendation becomes a real creative (exact offer type as headline, positioning/guarantee/urgency as body, an inferred CTA)", async () => {
  const pricingOffer: PricingOfferAgentOutput = {
    recommendedOfferType: "14-day free trial",
    pricingPositioning: "Priced below the two named incumbents for the same feature set.",
    guaranteeOrRiskReversal: "No credit card required to start.",
    urgencyAngle: "None recommended — insufficient research to ground one.",
  };

  const strategy = await createStrategyFromAgentResults(`biz_offer_${Date.now()}`, fakeAgentOutput(8), null, { pricingOffer });

  const offerCreative = strategy.creatives.find((c) => c.headline === "14-day free trial");
  assert.ok(offerCreative, "expected a creative headlined with the exact recommended offer type");
  assert.match(offerCreative!.body, /Priced below the two named incumbents/);
  assert.match(offerCreative!.body, /No credit card required/);
  assert.doesNotMatch(offerCreative!.body, /None recommended/i, "a 'None recommended' urgency angle must not appear as real body copy");
  assert.strictEqual(offerCreative!.callToAction, "Start Free Trial", "a trial offer should infer a trial-specific CTA, not a generic one");
  assert.ok(strategy.summary.includes("14-day free trial"), "the offer should also be reflected in the strategy summary");
});

test("createStrategyFromAgentResults - ObjectionHandlingAgent's objection/rebuttal pairs become real creatives, capped at 3, skipping unpaired objections", async () => {
  const objectionHandling: ObjectionHandlingAgentOutput = {
    topObjections: ["Isn't this expensive?", "Will it integrate with our stack?", "Is our data safe?", "An objection with no matching rebuttal"],
    rebuttalAngles: ["Costs less per seat than the market leader.", "Ships with 40+ native integrations.", "SOC 2 Type II certified, data encrypted at rest."],
    trustSignalsToHighlight: ["SOC 2 Type II"],
  };

  const strategy = await createStrategyFromAgentResults(`biz_objections_${Date.now()}`, fakeAgentOutput(8), null, { objectionHandling });

  const objectionCreatives = strategy.creatives.filter((c) => c.headline.includes("Isn't this expensive") || c.headline.includes("integrate") || c.headline.includes("data safe"));
  assert.strictEqual(objectionCreatives.length, 3, "expected exactly 3 objection-derived creatives (capped) — the 4th, unpaired objection must be skipped");
  const priceRebuttal = strategy.creatives.find((c) => c.headline === "Isn't this expensive?");
  assert.strictEqual(priceRebuttal!.body, "Costs less per seat than the market leader.");
  assert.strictEqual(priceRebuttal!.callToAction, "Learn More");
});

test("createStrategyFromAgentResults - ComplianceAgent's finding is attached when medium/high risk, omitted when low", async () => {
  const highRisk: ComplianceAgentOutput = {
    overallRisk: "high",
    flags: [{ agent: "creative-agent", severity: "high", issue: "Unsubstantiated medical claim", suggestion: "Remove or cite a source" }],
    restrictedCategoryConcerns: ["Health claims"],
    recommendation: "Do not launch without legal review.",
  };
  const strategyHigh = await createStrategyFromAgentResults(`biz_compliance_high_${Date.now()}`, fakeAgentOutput(8), null, { compliance: highRisk });
  assert.strictEqual(strategyHigh.complianceWarning?.risk, "high");
  assert.strictEqual(strategyHigh.complianceWarning?.flags.length, 1);
  assert.strictEqual(strategyHigh.complianceWarning?.recommendation, "Do not launch without legal review.");

  const lowRisk: ComplianceAgentOutput = { overallRisk: "low", flags: [], restrictedCategoryConcerns: [], recommendation: "No concerns." };
  const strategyLow = await createStrategyFromAgentResults(`biz_compliance_low_${Date.now()}`, fakeAgentOutput(8), null, { compliance: lowRisk });
  assert.strictEqual(strategyLow.complianceWarning, undefined, "a low-risk finding shouldn't surface a warning at all");
});
