import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, CREATIVE_GENERATION_QUEUE } from "../infra/queue.js";
import { runGenerationJob } from "../modules/generation/creativeGenerationService.js";
import { swapFatiguedCreative } from "../modules/optimization/creativeRotation.js";
import { isFinalFailure, sendToDeadLetter } from "../infra/deadLetterQueue.js";
import { registerGracefulShutdown } from "../infra/gracefulShutdown.js";
import { logger } from "../modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "../infra/errorTracking.js";

initErrorTracking("polluxa-creative-generation-worker");
registerCrashReporting("polluxa-creative-generation-worker");

/**
 * Standalone process — run with `npm run dev:worker --workspace apps/api` alongside
 * the gateway. Image/video generation can take seconds to minutes (Runway especially),
 * so this runs outside the request/response cycle instead of blocking a gateway worker thread.
 */
const worker = new Worker(
  CREATIVE_GENERATION_QUEUE,
  async (job: Job) => {
    const { jobId } = job.data as { jobId: string };
    await runGenerationJob(jobId);
    // Close the creative-fatigue loop: if this job was an auto-triggered fatigue refresh for a live
    // variant, rotate the fresh creative into the ad now (pause the stale ad, publish the new one in
    // the same ad set). swapFatiguedCreative no-ops for any non-fatigue / non-live job, so it's safe
    // to call unconditionally. Best-effort — a swap failure must not fail the generation job itself.
    try {
      const swap = await swapFatiguedCreative(jobId);
      if (swap.swapped) logger.info(`Fatigue creative rotated for job ${jobId}: ${swap.oldExternalId} -> ${swap.newExternalId}`);
    } catch (err) {
      logger.error(`Fatigue creative swap errored for job ${jobId}`, err);
    }
  },
  { connection: redisConnection, concurrency: 3 }
);

worker.on("completed", (job: Job) => logger.info(`Generation job completed: ${job.data?.jobId}`));
worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Generation job failed: ${job?.data?.jobId}`, err);
  captureError(err, { worker: "creativeGenerationWorker", jobId: job?.data?.jobId });
  if (job && isFinalFailure(job)) void sendToDeadLetter(CREATIVE_GENERATION_QUEUE, job, err);
});

registerGracefulShutdown(worker, "creativeGenerationWorker");
logger.info("Creative generation worker listening for jobs");
