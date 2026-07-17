import type { ResearchContext } from "../types/index.js";
import type { CampaignStrategy, StrategySimulationResult } from "./types.js";

/**
 * Simulation Engine — compares the strategies the Strategy Engine produced on 6 metrics
 * and ranks them. Deliberately code-computed, not another LLM call: asking a model to
 * self-report 6 numeric estimates across 3 items produces scores that aren't reliably
 * comparable to each other (same well-documented self-report-calibration problem the
 * Ranking Engine avoids for recommendations). Every metric here is derived from signals the
 * research pipeline and Strategy Engine already produced — market/competitor intensity,
 * budget, platform choice, and each strategy's own deterministic confidence.
 */

const HIGH_INTENSITY_KEYWORDS = ["high", "intense", "saturated", "crowded", "competitive", "fierce", "many", "numerous"];
const LOW_INTENSITY_KEYWORDS = ["low", "few", "limited", "underserved", "niche", "sparse", "minimal", "emerging", "little"];

function competitionBaseline(context: ResearchContext): number {
  const text = context.market?.competitionLevel ?? context.competitors?.competitionIntensity ?? "";
  const lower = text.toLowerCase();
  if (HIGH_INTENSITY_KEYWORDS.some((k) => lower.includes(k))) return 80;
  if (LOW_INTENSITY_KEYWORDS.some((k) => lower.includes(k))) return 25;
  return 55;
}

const CONTESTED_PLATFORMS = new Set(["meta", "google"]);
const REFERENCE_DAILY_BUDGET_CENTS = 10000;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function simulateOne(strategy: CampaignStrategy, context: ResearchContext): StrategySimulationResult {
  const baseline = competitionBaseline(context);
  const platformContestedness = strategy.platforms.filter((p) => CONTESTED_PLATFORMS.has(p)).length;
  const competition = clamp(baseline + platformContestedness * 5 - (strategy.platforms.length - platformContestedness) * 5);

  const budgetFactor = Math.min(strategy.budgetDailyCents / 200, 35);
  const reach = clamp(30 + strategy.platforms.length * 15 + budgetFactor);

  const confidencePct = strategy.confidence * 100;
  const expectedRoi = clamp(confidencePct * 0.5 + reach * 0.3 - competition * 0.3);
  const risk = clamp(competition * 0.5 + (100 - confidencePct) * 0.5);

  const budgetRatio = strategy.budgetDailyCents > 0 ? REFERENCE_DAILY_BUDGET_CENTS / strategy.budgetDailyCents : 1;
  const budgetEfficiency = clamp(expectedRoi * budgetRatio);

  const overallScore = clamp(
    reach * 0.15 + (100 - competition) * 0.15 + expectedRoi * 0.3 + (100 - risk) * 0.2 + confidencePct * 0.1 + budgetEfficiency * 0.1
  );

  return {
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    reach: Math.round(reach),
    competition: Math.round(competition),
    expectedRoi: Math.round(expectedRoi),
    risk: Math.round(risk),
    confidence: strategy.confidence,
    budgetEfficiency: Math.round(budgetEfficiency),
    overallScore: Math.round(overallScore * 100) / 100,
    rank: 0,
  };
}

export function simulateStrategies(strategies: CampaignStrategy[], context: ResearchContext): StrategySimulationResult[] {
  const simulated = strategies.map((strategy) => simulateOne(strategy, context));
  simulated.sort((a, b) => b.overallScore - a.overallScore);
  return simulated.map((result, index) => ({ ...result, rank: index + 1 }));
}
