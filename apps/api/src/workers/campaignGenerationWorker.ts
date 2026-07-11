import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, CAMPAIGN_GENERATION_QUEUE } from "../infra/queue.js";
import { runCampaignGenerationPipeline } from "../modules/orchestrator/campaignGenerationPipeline.js";
import { isFinalFailure, sendToDeadLetter } from "../infra/deadLetterQueue.js";
import { registerGracefulShutdown } from "../infra/gracefulShutdown.js";
import { logger } from "../modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "../infra/errorTracking.js";

initErrorTracking("adgo-campaign-generation-worker");
registerCrashReporting("adgo-campaign-generation-worker");

const worker = new Worker(
  CAMPAIGN_GENERATION_QUEUE,
  async (job: Job) => {
    const { jobId } = job.data as { jobId: string };
    return runCampaignGenerationPipeline(jobId, {
      onProgress: async (completed, total) => {
        await job.updateProgress(Math.round((completed / total) * 100));
      },
    });
  },
  { connection: redisConnection, concurrency: 2 }
);

worker.on("completed", (job: Job) => logger.info(`Campaign generation job completed: ${job.data?.jobId}`));
worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Campaign generation job failed: ${job?.data?.jobId}`, err);
  captureError(err, { worker: "campaignGenerationWorker", jobId: job?.data?.jobId });
  if (job && isFinalFailure(job)) void sendToDeadLetter(CAMPAIGN_GENERATION_QUEUE, job, err);
});

registerGracefulShutdown(worker, "campaignGenerationWorker");
logger.info("Campaign generation worker listening for jobs");
