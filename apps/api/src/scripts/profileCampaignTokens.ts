import "dotenv/config";
import { createCampaignGenerationJob } from "../modules/orchestrator/campaignGenerationService.js";
import { runCampaignGenerationPipeline } from "../modules/orchestrator/campaignGenerationPipeline.js";
import { snapshotTokens, resetTokens, isTokenMeterEnabled, type TokenCall } from "../infra/tokenMeter.js";
import { getOpenAIMonthSpendUsd } from "../infra/openaiBudget.js";

// Reuse an existing seeded business so the run profiles the real pipeline, not data setup.
const BUSINESS_ID = process.env.PROFILE_BUSINESS_ID ?? "0f1bf7b0-1b59-4ae6-8de3-4fc51a14f4ea"; // ClickUp
const WORKSPACE_ID = process.env.PROFILE_WORKSPACE_ID ?? "demo-workspace";
const URL = process.env.PROFILE_URL ?? "https://clickup.com";

function aggregate(calls: TokenCall[]) {
  const byProvider: Record<string, { calls: number; input: number; output: number }> = {};
  const byKind: Record<string, { calls: number; input: number; output: number }> = {};
  let totalIn = 0;
  let totalOut = 0;
  for (const c of calls) {
    totalIn += c.inputTokens;
    totalOut += c.outputTokens;
    (byProvider[c.provider] ??= { calls: 0, input: 0, output: 0 });
    byProvider[c.provider].calls++;
    byProvider[c.provider].input += c.inputTokens;
    byProvider[c.provider].output += c.outputTokens;
    (byKind[c.kind] ??= { calls: 0, input: 0, output: 0 });
    byKind[c.kind].calls++;
    byKind[c.kind].input += c.inputTokens;
    byKind[c.kind].output += c.outputTokens;
  }
  return { totalCalls: calls.length, totalIn, totalOut, total: totalIn + totalOut, byProvider, byKind };
}

async function main() {
  if (!isTokenMeterEnabled()) {
    // eslint-disable-next-line no-console
    console.error("Token meter is disabled. Run with TOKEN_METER_ENABLED=true");
    process.exit(1);
  }

  resetTokens();
  const startedAt = Date.now();

  const job = await createCampaignGenerationJob({ workspaceId: WORKSPACE_ID, businessId: BUSINESS_ID, url: URL });
  // eslint-disable-next-line no-console
  console.error(`[profile] created job ${job.id} for ${URL} — running pipeline (this exercises real provider/agent/decision LLM calls)...`);

  let result: unknown = null;
  let error: string | null = null;
  try {
    result = await runCampaignGenerationPipeline(job.id, {
      onProgress: (completed, total, step) => {
        // eslint-disable-next-line no-console
        console.error(`[progress] ${completed}/${total}${step ? ` — ${step}` : ""}`);
      },
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const elapsedMs = Date.now() - startedAt;
  const calls = snapshotTokens();
  const report = {
    business: { businessId: BUSINESS_ID, url: URL },
    jobId: job.id,
    completed: !error,
    error,
    elapsedMs,
    elapsedSec: Math.round(elapsedMs / 1000),
    openAISpendUsdThisMonth: getOpenAIMonthSpendUsd(),
    ...aggregate(calls),
    result,
  };

  // eslint-disable-next-line no-console
  console.log("\n===TOKEN_REPORT_JSON_START===");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log("===TOKEN_REPORT_JSON_END===");

  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("profile script crashed", err);
  process.exit(1);
});
