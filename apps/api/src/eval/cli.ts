import "dotenv/config";
import { runEvalCases, summarizeRun } from "./runner.js";
import { recordEvalRun } from "./evalRunService.js";
import { researchProviderEvalCases } from "./suites/researchProviders.eval.js";
import { aiAgentEvalCases } from "./suites/aiAgents.eval.js";
import type { EvalCase } from "./types.js";

const SUITES: Record<string, EvalCase<any>[]> = {
  "research-providers": researchProviderEvalCases,
  "ai-agents": aiAgentEvalCases,
};

/**
 * Run with `npm run eval:research` / `npm run eval:agents` (apps/api/package.json) — not
 * wired into CI by default, since every case here is a real, billed model/search call
 * (see each suite's own doc comment). Exits non-zero on any failing case so it CAN be
 * wired into a CI gate later without changing this file, once the team decides the cost
 * of running it on every PR is worth it.
 */
async function main() {
  const suiteName = process.argv[2];
  const cases = suiteName ? SUITES[suiteName] : undefined;
  if (!cases) {
    console.error(`Usage: tsx src/eval/cli.ts <suite>\nAvailable suites: ${Object.keys(SUITES).join(", ")}`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  console.log(`Running eval suite "${suiteName}" (${cases.length} cases)...\n`);
  const outcomes = await runEvalCases(cases);
  const summary = summarizeRun(suiteName, undefined, startedAt, outcomes);

  for (const c of summary.cases) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}  (score=${c.score}, ${c.durationMs}ms)`);
    console.log(`      ${c.notes}`);
    if (c.error) console.log(`      ERROR: ${c.error}`);
  }
  console.log(`\n${summary.passedCases}/${summary.totalCases} passed — avg score ${summary.avgScore}${summary.avgConfidence !== undefined ? `, avg confidence ${summary.avgConfidence}` : ""}`);

  const record = await recordEvalRun(summary);
  console.log(`Persisted as AiEvaluationRun ${record.id}`);

  process.exit(summary.passedCases === summary.totalCases ? 0 : 1);
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
