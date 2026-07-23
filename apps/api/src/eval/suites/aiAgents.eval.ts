import { StrategyAgent } from "../../agents/agents/StrategyAgent.js";
import { CreativeOfferAgent } from "../../agents/agents/CreativeOfferAgent.js";
import { ReviewerAgent } from "../../agents/agents/ReviewerAgent.js";
import type { AgentResult, CreativeOfferAgentOutput, ResearchContext, ReviewerAgentOutput, StrategyAgentOutput } from "../../agents/types/index.js";
import { combineChecks, inRange, minConfidence, nonEmptyArray, nonEmptyString } from "../checks.js";
import type { EvalCase } from "../types.js";

/** A rich, fully-populated ResearchContext fixture — same shape as the one
 * src/test/aiAgents.test.ts uses. A rich fixture is the right choice here because this suite's
 * job is to catch prompt-quality regressions on the happy path: "given good input, does this
 * composite agent's prompt still produce a sane, complete structured bundle?" */
function richFixtureContext(): ResearchContext {
  return {
    jobId: "eval",
    workspaceId: "eval",
    url: "https://acme-widgets.example.com",
    website: {
      title: "Acme Widgets — Premium Industrial Widgets",
      description: "Acme Widgets manufactures precision industrial widgets for aerospace and automotive clients.",
      excerpt: "Acme Widgets has served aerospace and automotive manufacturers for over 20 years with precision-engineered widgets.",
      images: [], crawledPages: ["https://acme-widgets.example.com"], pagesDiscovered: 1, dataSource: "crawl",
    },
    market: { trends: ["reshoring of industrial manufacturing", "demand for precision parts"], competitionLevel: "medium", recommendedRegion: "North America", dataSource: "Live web search" },
    technology: { cms: "Webflow", analyticsTools: ["Google Analytics"], frameworks: [], detectedFrom: ["page markup"], dataSource: "Response headers + page markup signature detection" },
    competitors: {
      competitors: [{ name: "Precision Parts Co" }, { name: "Global Widget Manufacturing" }],
      competitionIntensity: "Moderate — established players, few new entrants",
      differentiators: ["Faster lead times", "In-house quality certification"],
      dataSource: "Live web search",
    },
    keywords: { primaryKeywords: ["industrial widgets", "precision manufacturing", "aerospace parts"], headings: ["Precision Widgets for Aerospace & Automotive"], dataSource: "on-page" },
    audience: {
      primaryAudience: "Procurement managers at mid-size aerospace and automotive manufacturers",
      segments: [{ name: "Aerospace procurement", description: "Buyers sourcing certified precision parts" }],
      painPoints: ["long supplier lead times", "inconsistent part tolerances"],
      interestTags: ["industrial manufacturing", "aerospace supply chain"],
      dataSource: "Live web search",
    },
    company: { name: "Acme Widgets", summary: "20-year-old precision widget manufacturer serving aerospace and automotive.", dataSource: "Live web search" },
    news: { articles: [], summary: "No recent news coverage found.", dataSource: "No recent news coverage found" },
    reviews: { topPraise: ["reliable lead times"], topComplaints: ["premium pricing"], reviewSources: ["G2"], dataSource: "Live web search" },
    metadata: {
      jobId: "eval", generatedAt: new Date().toISOString(), totalDurationMs: 0,
      providersSucceeded: ["website", "market", "technology", "competitor", "seo", "audience", "company"], providersPartial: ["news"], providersFailed: [],
      confidenceByProvider: {}, overallConfidence: 0,
    },
  };
}

/**
 * One case per composite super-agent — happy-path-only. This suite asserts "given rich,
 * real-shaped research, does this composite's prompt still produce a sane, complete structured
 * BUNDLE with every sub-part populated", which is exactly what a prompt-wording change risks
 * breaking silently. Every case makes a REAL model call (same cost/time caveat as the
 * research-providers suite) — run via `npm run eval:agents`, not on every commit.
 */
export const aiAgentEvalCases: EvalCase<AgentResult<unknown>>[] = [
  {
    name: "strategy-agent / rich context produces a coherent campaign+audience+keyword+budget bundle",
    run: () => new StrategyAgent().execute(richFixtureContext()),
    check: (result) => {
      const data = result.data as StrategyAgentOutput;
      const splitSum = Object.values(data.campaign?.budgetSplit ?? {}).reduce((sum, v) => sum + v, 0);
      const splitSumsToOne = Math.abs(splitSum - 1) < 0.05;
      return combineChecks(
        nonEmptyArray(data.campaign?.recommendedNetworks, "campaign.recommendedNetworks", 1),
        nonEmptyArray(data.campaign?.creatives, "campaign.creatives", 1),
        { pass: splitSumsToOne, score: splitSumsToOne ? 1 : 0, notes: `campaign.budgetSplit sums to ${splitSum}` },
        nonEmptyArray(data.audience?.personas, "audience.personas", 1),
        nonEmptyArray(data.keyword?.primaryKeywords, "keyword.primaryKeywords", 1),
        inRange(data.budget?.recommendedDailyBudgetCents, 100, 100_000_00, "budget.recommendedDailyBudgetCents"),
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "creative-offer-agent / rich context produces creative+offer+objection bundle",
    run: () => new CreativeOfferAgent().execute(richFixtureContext()),
    check: (result) => {
      const data = result.data as CreativeOfferAgentOutput;
      return combineChecks(
        nonEmptyArray(data.creative?.headlines, "creative.headlines", 1),
        nonEmptyString(data.pricingOffer?.recommendedOfferType, "pricingOffer.recommendedOfferType"),
        nonEmptyArray(data.objectionHandling?.topObjections, "objectionHandling.topObjections", 1),
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "reviewer-agent / rich context + proposals produces critic+compliance verdicts",
    run: () => {
      // The reviewer needs producer proposals to review — give it a minimal but real one.
      const priorResults = {
        "campaign-agent": {
          agent: "campaign-agent", promptId: "campaign-agent", promptVersion: 1,
          data: { summary: "Meta-led lead-gen for aerospace procurement buyers", recommendedNetworks: ["meta"], budgetSplit: { meta: 1 }, audiences: ["Aerospace procurement"], creatives: [{ headline: "Certified precision widgets", body: "20-year track record", callToAction: "Get a quote" }] },
          confidence: 0.8, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1,
        },
      };
      return new ReviewerAgent().execute(richFixtureContext(), { priorResults });
    },
    check: (result) => {
      const data = result.data as ReviewerAgentOutput;
      const scoreOk = typeof data.critic?.overallScore === "number" && data.critic.overallScore >= 0 && data.critic.overallScore <= 100;
      const riskOk = ["low", "medium", "high"].includes(data.compliance?.overallRisk);
      return combineChecks(
        { pass: scoreOk, score: scoreOk ? 1 : 0, notes: `critic.overallScore = ${data.critic?.overallScore}` },
        { pass: riskOk, score: riskOk ? 1 : 0, notes: `compliance.overallRisk = ${data.compliance?.overallRisk}` },
        nonEmptyString(data.critic?.recommendation, "critic.recommendation"),
        nonEmptyString(data.compliance?.recommendation, "compliance.recommendation"),
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
];
