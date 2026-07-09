import { logger } from "../modules/logger/logger.js";
import type { EvalCase, EvalCaseOutcome, EvalRunSummary } from "./types.js";

/**
 * Runs every case in a suite SEQUENTIALLY (not in parallel like the research providers/
 * agents themselves) — golden-dataset runs are deliberately slower/quieter than production
 * traffic; there's no latency requirement to justify the added complexity of fanning out,
 * and running one at a time keeps a failing case's stack trace attributable without
 * needing to correlate interleaved logs. A throwing case becomes a failed outcome (score 0)
 * rather than aborting the whole suite, so one broken case doesn't hide every other case's
 * result.
 */
export async function runEvalCases<T>(cases: EvalCase<T>[]): Promise<EvalCaseOutcome[]> {
  const outcomes: EvalCaseOutcome[] = [];

  for (const evalCase of cases) {
    const start = Date.now();
    try {
      const result = await evalCase.run();
      const { pass, score, notes } = evalCase.check(result);
      outcomes.push({
        name: evalCase.name,
        pass,
        score,
        confidence: evalCase.confidence?.(result),
        notes,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Eval case "${evalCase.name}" threw`, err);
      outcomes.push({ name: evalCase.name, pass: false, score: 0, notes: "Case threw an error", durationMs: Date.now() - start, error: message });
    }
  }

  return outcomes;
}

export function summarizeRun(suite: string, target: string | undefined, startedAt: string, outcomes: EvalCaseOutcome[]): EvalRunSummary {
  const totalCases = outcomes.length;
  const passedCases = outcomes.filter((o) => o.pass).length;
  const avgScore = totalCases > 0 ? round(outcomes.reduce((sum, o) => sum + o.score, 0) / totalCases) : 0;
  const confidences = outcomes.map((o) => o.confidence).filter((c): c is number => typeof c === "number");
  const avgConfidence = confidences.length > 0 ? round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length) : undefined;

  return {
    suite,
    target,
    totalCases,
    passedCases,
    avgScore,
    avgConfidence,
    cases: outcomes,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
