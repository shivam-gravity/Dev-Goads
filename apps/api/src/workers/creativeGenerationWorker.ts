import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, CREATIVE_GENERATION_QUEUE } from "../infra/queue.js";
import { runGenerationJob } from "../modules/generation/creativeGenerationService.js";
import { logger } from "../modules/logger/logger.js";

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
  },
  { connection: redisConnection, concurrency: 3 }
);

worker.on("completed", (job: Job) => logger.info(`Generation job completed: ${job.data?.jobId}`));
worker.on("failed", (job: Job | undefined, err: Error) => logger.error(`Generation job failed: ${job?.data?.jobId}`, err));

logger.info("Creative generation worker listening for jobs");
