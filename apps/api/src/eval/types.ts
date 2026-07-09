/**
 * The AI Evaluation harness's own type surface — deliberately generic over what's being
 * evaluated (a research provider, an AI agent, anything with a scoreable output) so the
 * same runner/persistence code serves every suite rather than one harness per layer.
 */

export interface EvalCheckResult {
  pass: boolean;
  /** 0-1 — a graded score, not just pass/fail, since "technically passed but weak" (e.g.
   * a competitor list with only the minimum acceptable count) is worth distinguishing from
   * a strong result when tracking quality over time, not just a binary regression gate. */
  score: number;
  notes: string;
}

export interface EvalCase<TResult> {
  name: string;
  /** Runs the actual provider/agent call this case evaluates — a real network/model call
   * by design (a golden-dataset eval that never calls the real thing can't catch a real
   * prompt or provider regression), so suites keep their case count deliberately small. */
  run: () => Promise<TResult>;
  check: (result: TResult) => EvalCheckResult;
  /** Optional — lets a check pull the case's own confidence score (every ProviderResult/
   * AgentResult already reports one) into the run summary's avgConfidence without every
   * check needing to know how to extract it from its own TResult shape. */
  confidence?: (result: TResult) => number;
}

export interface EvalCaseOutcome {
  name: string;
  pass: boolean;
  score: number;
  confidence?: number;
  notes: string;
  durationMs: number;
  error?: string;
}

export interface EvalRunSummary {
  suite: string;
  target?: string;
  totalCases: number;
  passedCases: number;
  avgScore: number;
  avgConfidence?: number;
  cases: EvalCaseOutcome[];
  startedAt: string;
  completedAt: string;
}
