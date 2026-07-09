import { BudgetAgent } from "../../agents/agents/BudgetAgent.js";
import { CampaignAgent } from "../../agents/agents/CampaignAgent.js";
import { CompetitorAgent } from "../../agents/agents/CompetitorAgent.js";
import { ProductAgent } from "../../agents/agents/ProductAgent.js";
import type { AgentResult, BudgetAgentOutput, CampaignAgentOutput, CompetitorAgentOutput, ProductAgentOutput } from "../../agents/types/index.js";
import type { ResearchContext } from "../../research/types/index.js";
import { combineChecks, inRange, minConfidence, nonEmptyArray, nonEmptyString } from "../checks.js";
import type { EvalCase } from "../types.js";

/** A rich, fully-populated ResearchContext fixture — same shape as the one
 * src/test/aiAgents.test.ts already uses, deliberately kept in sync with it (see that
 * file if this one needs updating) since both exist to answer "does an agent behave
 * correctly given good input", just via different mechanisms (unit assertion vs. graded
 * eval score). A rich fixture is the right choice here specifically because this suite's
 * job is to catch prompt-quality regressions on the happy path — a separate concern from
 * the research-providers suite's fallback-path coverage. */
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
    metadata: {
      jobId: "eval", generatedAt: new Date().toISOString(), totalDurationMs: 0,
      providersSucceeded: ["website", "market", "technology", "competitor", "seo", "audience", "company"], providersPartial: ["news"], providersFailed: [],
      confidenceByProvider: {}, overallConfidence: 0,
    },
  };
}

/**
 * Deliberately small (4 cases, one per agent) and happy-path-only — this suite asserts
 * "given rich, real-shaped research, does this agent's prompt still produce a sane,
 * complete structured output", which is exactly what a prompt-wording change risks
 * breaking silently. Every case makes a REAL model call (same cost/time caveat as the
 * research-providers suite) — run via `npm run eval:agents`, not on every commit.
 */
export const aiAgentEvalCases: EvalCase<AgentResult<unknown>>[] = [
  {
    name: "product-agent / rich context produces a complete, non-generic product summary",
    run: () => new ProductAgent().execute(richFixtureContext()),
    check: (result) => {
      const data = result.data as ProductAgentOutput;
      return combineChecks(
        nonEmptyString(data.productName, "productName"),
        nonEmptyString(data.valueProposition, "valueProposition"),
        nonEmptyArray(data.keyFeatures, "keyFeatures", 1),
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "competitor-agent / rich context produces named competitors and a positioning call",
    run: () => new CompetitorAgent().execute(richFixtureContext()),
    check: (result) => {
      const data = result.data as CompetitorAgentOutput;
      return combineChecks(
        nonEmptyArray(data.competitors, "competitors", 1),
        nonEmptyString(data.positioningRecommendation, "positioningRecommendation"),
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "budget-agent / rich context produces a positive budget with explainable reasoning",
    run: () => new BudgetAgent().execute(richFixtureContext()),
    check: (result) => {
      const data = result.data as BudgetAgentOutput;
      return combineChecks(
        inRange(data.recommendedDailyBudgetCents, 100, 100_000_00, "recommendedDailyBudgetCents"),
        nonEmptyArray(data.reasoning, "reasoning", 1),
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
  {
    name: "campaign-agent / rich context produces a coherent strategy with a budget split that sums to ~1",
    run: () => new CampaignAgent().execute(richFixtureContext()),
    check: (result) => {
      const data = result.data as CampaignAgentOutput;
      const splitSum = Object.values(data.budgetSplit ?? {}).reduce((sum, v) => sum + v, 0);
      const splitSumsToOne = Math.abs(splitSum - 1) < 0.05;
      return combineChecks(
        nonEmptyArray(data.recommendedNetworks, "recommendedNetworks", 1),
        nonEmptyArray(data.creatives, "creatives", 1),
        { pass: splitSumsToOne, score: splitSumsToOne ? 1 : 0, notes: `budgetSplit sums to ${splitSum}` },
        minConfidence(result.confidence, 0.5)
      );
    },
    confidence: (r) => r.confidence,
  },
];
