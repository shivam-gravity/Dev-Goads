import type { EvalCheckResult } from "./types.js";

/** Composes multiple checks into one, averaging their scores and requiring every one to
 * pass — most golden cases want to assert several things at once (non-empty, real data,
 * confidence above a floor) without hand-rolling the pass/score/notes bookkeeping each time. */
export function combineChecks(...results: EvalCheckResult[]): EvalCheckResult {
  const pass = results.every((r) => r.pass);
  const score = results.length > 0 ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / results.length) * 100) / 100 : 0;
  const notes = results.map((r) => r.notes).join("; ");
  return { pass, score, notes };
}

export function nonEmptyArray(arr: unknown[] | undefined, label: string, minLength = 1): EvalCheckResult {
  const length = arr?.length ?? 0;
  const pass = length >= minLength;
  return { pass, score: pass ? 1 : 0, notes: `${label}: ${length} item(s) (need >=${minLength})` };
}

export function nonEmptyString(value: string | undefined, label: string): EvalCheckResult {
  const pass = Boolean(value && value.trim().length > 0);
  return { pass, score: pass ? 1 : 0, notes: `${label}: ${pass ? "present" : "empty/missing"}` };
}

export function minConfidence(confidence: number, threshold: number): EvalCheckResult {
  const pass = confidence >= threshold;
  return { pass, score: confidence, notes: `confidence ${confidence} (need >=${threshold})` };
}

export function inRange(value: number, min: number, max: number, label: string): EvalCheckResult {
  const pass = value >= min && value <= max;
  return { pass, score: pass ? 1 : 0, notes: `${label}: ${value} (expected ${min}-${max})` };
}

/** Passes only when the field's dataSource is NOT one of the two known no-live-data
 * fallback strings — i.e. asserts a provider actually reached a real model/search, not
 * just its labeled-fallback path. A separate golden case should assert the opposite
 * (fallback DOES engage for a nonsense/unreachable URL) so both directions of the
 * graceful-degradation contract are covered, not just the happy path. */
export function usedRealData(dataSource: string | undefined, knownFallbackStrings: string[]): EvalCheckResult {
  const pass = Boolean(dataSource) && !knownFallbackStrings.includes(dataSource!);
  return { pass, score: pass ? 1 : 0, notes: `dataSource: "${dataSource ?? "(none)"}"` };
}
