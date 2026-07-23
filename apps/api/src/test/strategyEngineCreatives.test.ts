import { test, after } from "node:test";
import assert from "node:assert";
import { createStrategyFromAgentResults, createStrategyFromResearch, type ResearchStrategyInput } from "../modules/strategy/strategyEngine.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";
import type { CampaignAgentOutput, ComplianceAgentOutput, CreativeAgentOutput, CriticAgentOutput, ObjectionHandlingAgentOutput, PricingOfferAgentOutput } from "../agents/types/index.js";
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

test("createStrategyFromAgentResults - CreativeAgent's copy pool populates AdCreative.headlines[]/primaryTexts[]/descriptions[], deduped, capped, with the creative's own headline/body first", async () => {
  const creative: CreativeAgentOutput = {
    // Includes the creative's own headline ("Creative 1") and a duplicate ("Alt A") to prove dedupe,
    // plus enough distinct entries to overflow the cap of 5.
    headlines: ["Creative 1", "Alt A", "Alt A", "Alt B", "Alt C", "Alt D", "Alt E"],
    primaryTexts: ["Body for creative 1", "Alt body 1", "Alt body 2", "Alt body 1"],
    // Google RSA descriptions: a duplicate ("Desc A") to prove dedupe, plus enough to overflow cap 4.
    descriptions: ["Desc A", "Desc A", "Desc B", "Desc C", "Desc D", "Desc E"],
    callToAction: "Sign Up",
    creativeAngles: ["urgency"],
  };

  const strategy = await createStrategyFromAgentResults(`biz_creative_${Date.now()}`, fakeAgentOutput(8), null, { creative });
  const first = strategy.creatives[0];

  assert.strictEqual(first.headlines?.[0], "Creative 1", "the creative's own headline must be the first variant (back-compat)");
  assert.strictEqual(first.primaryTexts?.[0], "Body for creative 1", "the creative's own body must be the first primary-text variant");
  assert.strictEqual(first.headlines?.length, 5, "headline variants must be capped at 5");
  assert.strictEqual(new Set(first.headlines).size, first.headlines?.length, "headline variants must be de-duped (own headline + duplicate 'Alt A' collapse)");
  assert.strictEqual(first.primaryTexts?.length, 3, "3 distinct primary texts survive after 'Alt body 1' is de-duped");
  assert.strictEqual(new Set(first.primaryTexts).size, first.primaryTexts?.length, "primary-text variants must be de-duped");

  // RSA descriptions: creative's own body first, agent's distinct descriptions appended, deduped, capped at 4.
  assert.strictEqual(first.descriptions?.[0], "Body for creative 1", "the creative's own body must be the first RSA description (sensible default)");
  assert.strictEqual(first.descriptions?.length, 4, "RSA descriptions must be capped at Google's max of 4");
  assert.strictEqual(new Set(first.descriptions).size, first.descriptions?.length, "RSA descriptions must be de-duped");
});

test("createStrategyFromAgentResults - without the creative extra, creatives carry no headlines[]/primaryTexts[] (byte-identical to today)", async () => {
  const agentOutput = fakeAgentOutput(8);
  const noExtras = await createStrategyFromAgentResults(`biz_creative_none_a_${Date.now()}`, agentOutput);
  const emptyExtras = await createStrategyFromAgentResults(`biz_creative_none_b_${Date.now()}`, agentOutput, null, {});

  for (const c of noExtras.creatives) {
    assert.strictEqual(c.headlines, undefined, "no creative extra → no headline variants");
    assert.strictEqual(c.primaryTexts, undefined, "no creative extra → no primary-text variants");
  }
  // Creatives are deterministic for a given agent output (only strategy id/createdAt differ), so an
  // empty extras object must yield the exact same creatives array as passing no extras at all.
  assert.deepStrictEqual(emptyExtras.creatives, noExtras.creatives, "an empty extras object must produce identical creatives to passing no extras at all");
});

test("createStrategyFromAgentResults - CriticAgent's review attaches a qualityWarning when the score is below the threshold", async () => {
  const critic: CriticAgentOutput = {
    overallScore: 55,
    issues: [],
    missingData: ["pricing", "reviews"],
    recommendation: "Proceed with caveats.",
  };
  const strategy = await createStrategyFromAgentResults(`biz_critic_low_${Date.now()}`, fakeAgentOutput(8), null, { critic });
  assert.strictEqual(strategy.qualityWarning?.score, 55);
  assert.deepStrictEqual(strategy.qualityWarning?.missingData, ["pricing", "reviews"]);
  assert.strictEqual(strategy.qualityWarning?.recommendation, "Proceed with caveats.");
});

test("createStrategyFromAgentResults - CriticAgent's review attaches a qualityWarning when there are issues, even at a high score", async () => {
  const critic: CriticAgentOutput = {
    overallScore: 92,
    issues: [{ agent: "creative-agent", severity: "medium", issue: "Headline overstates the benefit" }],
    missingData: [],
    recommendation: "Proceed, but soften the headline claim.",
  };
  const strategy = await createStrategyFromAgentResults(`biz_critic_issues_${Date.now()}`, fakeAgentOutput(8), null, { critic });
  assert.strictEqual(strategy.qualityWarning?.score, 92);
  assert.strictEqual(strategy.qualityWarning?.issues.length, 1);
});

test("createStrategyFromAgentResults - a clean, high-scoring critic review surfaces no qualityWarning", async () => {
  const critic: CriticAgentOutput = {
    overallScore: 88,
    issues: [],
    missingData: [],
    recommendation: "Proceed as-is.",
  };
  const strategy = await createStrategyFromAgentResults(`biz_critic_clean_${Date.now()}`, fakeAgentOutput(8), null, { critic });
  assert.strictEqual(strategy.qualityWarning, undefined, "a clean, high-scoring review shouldn't surface a warning at all");
});

test("createStrategyFromAgentResults - a damning critic review is advisory only and never gates/fails the build", async () => {
  const critic: CriticAgentOutput = {
    overallScore: 5,
    issues: [{ agent: "campaign-agent", severity: "high", issue: "Recommendations not grounded in research" }],
    missingData: ["audience", "competitors"],
    recommendation: "Do not proceed without more research.",
  };
  const strategy = await createStrategyFromAgentResults(`biz_critic_severe_${Date.now()}`, fakeAgentOutput(8), null, { critic });
  // Advisory only: the build completes and the strategy is fully formed despite a damning review.
  assert.ok(strategy.id, "strategy must still be built");
  assert.strictEqual(strategy.creatives.length, 8, "creatives must be unaffected by the critic review");
  assert.strictEqual(strategy.qualityWarning?.score, 5);
});

// ── identity-vertical-mismatch → qualityWarning (Fix #3 Part 2, Option C: flag + downgrade) ──

const IDENTITY_CONFLICT = {
  kind: "identity-vertical-mismatch",
  severity: "high" as const,
  description: "The website's own description and the market research describe different industries — their vertical vocabulary is nearly disjoint (overlap 0%).",
  sources: ["website", "market"],
};

test("createStrategyFromAgentResults - a high-severity identity-vertical-mismatch attaches a qualityWarning even with no critic result", async () => {
  const strategy = await createStrategyFromAgentResults(`biz_identity_only_${Date.now()}`, fakeAgentOutput(8), null, {
    identityConflicts: [IDENTITY_CONFLICT],
  });
  assert.ok(strategy.qualityWarning, "an identity mismatch alone must surface a qualityWarning");
  assert.strictEqual(strategy.qualityWarning!.score, 40, "created warning is capped at the identity-mismatch score");
  assert.ok(strategy.qualityWarning!.issues.some((i) => i.agent === "knowledge-fusion" && /industry/i.test(i.issue)), "the identity issue is present");
});

test("createStrategyFromAgentResults - no qualityWarning when there is neither a critic result nor an identity conflict", async () => {
  const strategy = await createStrategyFromAgentResults(`biz_identity_none_${Date.now()}`, fakeAgentOutput(8), null, {
    identityConflicts: [],
  });
  assert.strictEqual(strategy.qualityWarning, undefined, "no critic + no identity conflict → no warning");
});

test("createStrategyFromAgentResults - a non-high or non-identity conflict does NOT attach an identity warning", async () => {
  const strategy = await createStrategyFromAgentResults(`biz_identity_lowsev_${Date.now()}`, fakeAgentOutput(8), null, {
    identityConflicts: [
      { ...IDENTITY_CONFLICT, severity: "medium" }, // right kind, wrong severity
      { kind: "market-competitor-intensity-mismatch", severity: "high", description: "x", sources: ["market", "competitor"] }, // high, wrong kind
    ],
  });
  assert.strictEqual(strategy.qualityWarning, undefined, "only a HIGH-severity identity-vertical-mismatch triggers the warning");
});

test("createStrategyFromAgentResults - identity conflict MERGES into an existing critic warning, not clobbering it (score downgraded, issues appended)", async () => {
  const critic: CriticAgentOutput = {
    overallScore: 88,
    issues: [{ agent: "campaign-agent", severity: "medium", issue: "Weak differentiation" }],
    missingData: ["pricing"],
    recommendation: "Tighten the value prop.",
  };
  const strategy = await createStrategyFromAgentResults(`biz_identity_merge_${Date.now()}`, fakeAgentOutput(8), null, {
    critic,
    identityConflicts: [IDENTITY_CONFLICT],
  });
  const w = strategy.qualityWarning!;
  assert.strictEqual(w.score, 40, "score downgraded to the identity cap (min of critic 88 and 40)");
  assert.deepStrictEqual(w.missingData, ["pricing"], "critic's missingData is preserved (not clobbered)");
  assert.strictEqual(w.recommendation, "Tighten the value prop.", "critic's recommendation is preserved");
  assert.ok(w.issues.some((i) => i.agent === "campaign-agent"), "the original critic issue is kept");
  assert.ok(w.issues.some((i) => i.agent === "knowledge-fusion"), "the identity issue is appended");
  assert.strictEqual(w.issues.length, 2, "both issues present, none dropped");
});

test("createStrategyFromAgentResults - a critic warning already below the identity cap keeps its lower score when merged", async () => {
  const critic: CriticAgentOutput = {
    overallScore: 22,
    issues: [{ agent: "campaign-agent", severity: "high", issue: "Ungrounded" }],
    missingData: [],
    recommendation: "Re-research.",
  };
  const strategy = await createStrategyFromAgentResults(`biz_identity_lowcritic_${Date.now()}`, fakeAgentOutput(8), null, {
    critic,
    identityConflicts: [IDENTITY_CONFLICT],
  });
  assert.strictEqual(strategy.qualityWarning!.score, 22, "min(22, 40) = 22 — the already-lower critic score wins");
  assert.strictEqual(strategy.qualityWarning!.issues.length, 2, "identity issue still appended");
});
