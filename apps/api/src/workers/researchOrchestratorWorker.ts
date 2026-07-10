import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, RESEARCH_ORCHESTRATOR_QUEUE } from "../infra/queue.js";
import { runResearchOrchestrator } from "../research/research-orchestrator/ResearchOrchestrator.js";
import { isFinalFailure, sendToDeadLetter } from "../infra/deadLetterQueue.js";
import { registerGracefulShutdown } from "../infra/gracefulShutdown.js";
import { logger } from "../modules/logger/logger.js";

/**
 * Standalone process — run with `npm run dev:research-orchestrator-worker --workspace
 * apps/api` alongside the gateway, same pattern as researchSessionWorker.ts. Fanning 9
 * providers out in parallel (several of them real, billed web searches) is slow and
 * costly enough that it has to run outside the request/response cycle.
 */
const worker = new Worker(
  RESEARCH_ORCHESTRATOR_QUEUE,
  async (job: Job) => {
    const { jobId } = job.data as { jobId: string };
    return runResearchOrchestrator(jobId, {
      onProgress: async (completed, total) => {
        await job.updateProgress(Math.round((completed / total) * 100));
      },
    });
  },
  { connection: redisConnection, concurrency: 3 }
);

worker.on("completed", (job: Job) => logger.info(`Research orchestrator job completed: ${job.data?.jobId}`));
worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Research orchestrator job failed: ${job?.data?.jobId}`, err);
  if (job && isFinalFailure(job)) void sendToDeadLetter(RESEARCH_ORCHESTRATOR_QUEUE, job, err);
});

registerGracefulShutdown(worker, "researchOrchestratorWorker");
logger.info("Research orchestrator worker listening for jobs");
