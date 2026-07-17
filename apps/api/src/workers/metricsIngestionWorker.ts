import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, METRICS_INGESTION_QUEUE, metricsIngestionQueue } from "../infra/queue.js";
import { listActiveCampaigns } from "../modules/orchestrator/campaignOrchestrator.js";
import { ingestCampaignMetrics } from "../modules/pipeline/performancePipeline.js";
import { runOptimizationPass } from "../modules/optimization/optimizationEngine.js";
import { recordOptimizationInsights } from "../modules/insights/insightService.js";
import { recordCampaignOutcome } from "../research/decision/campaign-learning-engine.js";
import { recordPerformanceSnapshot } from "../research/decision/campaign-intelligence-store.js";
import { emitInsightsUpdate, emitOptimizationAction } from "../infra/realtimeBridge.js";
import { isFinalFailure, sendToDeadLetter } from "../infra/deadLetterQueue.js";
import { registerGracefulShutdown } from "../infra/gracefulShutdown.js";
import { logger } from "../modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "../infra/errorTracking.js";

initErrorTracking("polluxa-metrics-ingestion-worker");
registerCrashReporting("polluxa-metrics-ingestion-worker");

const INGEST_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const REPEATABLE_JOB_NAME = "ingest-active-campaigns";

/**
 * Standalone process — run with `npm run dev:metrics-worker --workspace apps/api` alongside
 * the gateway, same pattern as leadIngestionWorker.ts/creativeGenerationWorker.ts. Powers the
 * Live Insights Dashboard: on each interval, pulls fresh metrics for every active campaign
 * and immediately runs the optimization pass on it, so fresh data and fresh AI suggestions
 * land together instead of requiring a separate manual trigger for each.
 */
const worker = new Worker(
  METRICS_INGESTION_QUEUE,
  async (job: Job) => {
    if (job.name !== REPEATABLE_JOB_NAME) {
      logger.warn(`metricsIngestionWorker: unknown job name "${job.name}"`);
      return;
    }

    const campaigns = await listActiveCampaigns();
    logger.info(`Metrics ingestion tick: ${campaigns.length} active campaign(s)`);

    for (const { id: campaignId, workspaceId } of campaigns) {
      try {
        await ingestCampaignMetrics(campaignId);
        const decisions = await runOptimizationPass(campaignId);
        await recordOptimizationInsights(workspaceId, decisions);
        // Campaign Intelligence: a real point-in-time performance snapshot every tick,
        // independent of whether there's enough data for a reliable "outcome" yet — feeds
        // the Benchmark Engine's future industry/platform aggregations.
        await recordPerformanceSnapshot(campaignId);
        // Cross-campaign learning: attributes this campaign's real performance back to the
        // recommendations that produced it, so the NEXT campaign-generation run (this
        // workspace or any other) ranks similar recommendations using what actually
        // happened, not just what the research alone predicted. No-ops until there's
        // enough real conversion data — never blocks ingestion/optimization above.
        await recordCampaignOutcome(campaignId);

        // Real-time push: notify connected browsers of fresh metrics + any AI decisions
        void emitInsightsUpdate(workspaceId, campaignId, { refreshedAt: Date.now() });
        if (decisions && decisions.length > 0) {
          for (const d of decisions) {
            void emitOptimizationAction(workspaceId, d.action ?? "optimize", d);
          }
        }
      } catch (err) {
        // One campaign's failure (e.g. a since-deleted variant, a transient Ads API error)
        // shouldn't stop the rest of the fan-out from ingesting.
        logger.error(`Metrics ingestion/optimization failed for campaign ${campaignId}`, err);
        captureError(err, { worker: "metricsIngestionWorker", campaignId, workspaceId });
      }
    }
  },
  { connection: redisConnection, concurrency: 1 }
);

worker.on("completed", () => logger.info("Metrics ingestion tick completed"));
worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Metrics ingestion job failed: ${job?.name}`, err);
  captureError(err, { worker: "metricsIngestionWorker", jobName: job?.name });
  if (job && isFinalFailure(job)) void sendToDeadLetter(METRICS_INGESTION_QUEUE, job, err);
});

// Registering a repeatable job with the same jobId is idempotent — BullMQ replaces the
// existing schedule rather than stacking duplicates, so restarting this worker never
// produces multiple concurrent tickers.
await metricsIngestionQueue.add(REPEATABLE_JOB_NAME, {}, { repeat: { every: INGEST_INTERVAL_MS }, jobId: REPEATABLE_JOB_NAME });

registerGracefulShutdown(worker, "metricsIngestionWorker");
logger.info(`Metrics ingestion worker listening for jobs (every ${INGEST_INTERVAL_MS / 60000} minutes)`);
