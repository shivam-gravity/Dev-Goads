import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, METRICS_INGESTION_QUEUE, metricsIngestionQueue } from "../infra/queue.js";
import { listActiveCampaigns } from "../modules/orchestrator/campaignOrchestrator.js";
import { ingestCampaignMetrics } from "../modules/pipeline/performancePipeline.js";
import { runOptimizationPass } from "../modules/optimization/optimizationEngine.js";
import { recordOptimizationInsights } from "../modules/insights/insightService.js";
import { logger } from "../modules/logger/logger.js";

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
      } catch (err) {
        // One campaign's failure (e.g. a since-deleted variant, a transient Ads API error)
        // shouldn't stop the rest of the fan-out from ingesting.
        logger.error(`Metrics ingestion/optimization failed for campaign ${campaignId}`, err);
      }
    }
  },
  { connection: redisConnection, concurrency: 1 }
);

worker.on("completed", () => logger.info("Metrics ingestion tick completed"));
worker.on("failed", (job: Job | undefined, err: Error) => logger.error(`Metrics ingestion job failed: ${job?.name}`, err));

// Registering a repeatable job with the same jobId is idempotent — BullMQ replaces the
// existing schedule rather than stacking duplicates, so restarting this worker never
// produces multiple concurrent tickers.
await metricsIngestionQueue.add(REPEATABLE_JOB_NAME, {}, { repeat: { every: INGEST_INTERVAL_MS }, jobId: REPEATABLE_JOB_NAME });

logger.info(`Metrics ingestion worker listening for jobs (every ${INGEST_INTERVAL_MS / 60000} minutes)`);
