import "dotenv/config";
import { Worker, Queue, type Job } from "bullmq";
import { redisConnection } from "../infra/queue.js";
import { isFinalFailure, sendToDeadLetter } from "../infra/deadLetterQueue.js";
import { registerGracefulShutdown } from "../infra/gracefulShutdown.js";
import { logger } from "../modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "../infra/errorTracking.js";
import { evaluateRulesForWorkspace } from "../modules/automation/automationRuleEngine.js";
import { prisma } from "../db/prisma.js";

initErrorTracking("polluxa-automation-rule-worker");
registerCrashReporting("polluxa-automation-rule-worker");

// ─── Queue definition (inline, same pattern as other queues in queue.ts) ─────
const AUTOMATION_RULE_QUEUE = "automation-rule-evaluation";

const automationRuleQueue = new Queue(AUTOMATION_RULE_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

// Offset by 2 minutes from metricsIngestionWorker (15 min) so metrics are fresh
// when rules evaluate: metrics land at T+0, rules evaluate at T+2.
const EVALUATION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const REPEATABLE_JOB_NAME = "evaluate-automation-rules";

/**
 * Standalone process — run with `npm run dev:automation-rule-worker --workspace apps/api`
 * alongside the gateway. Evaluates user-defined automation rules against live campaign
 * metrics on a repeatable schedule. Each tick:
 *   1. Discovers all workspaces that have at least one enabled automation rule
 *   2. For each workspace, evaluates all enabled rules against all active campaigns
 *   3. Triggers actions (pause, budget change, notification) when conditions are met
 *   4. Respects per-rule cooldowns to prevent action storms
 */
const worker = new Worker(
  AUTOMATION_RULE_QUEUE,
  async (job: Job) => {
    if (job.name !== REPEATABLE_JOB_NAME) {
      logger.warn(`automationRuleWorker: unknown job name "${job.name}"`);
      return;
    }

    // Discover workspaces with enabled automation rules by querying distinct workspaceIds
    const workspaceRows = await prisma.automationRule.findMany({
      select: { workspaceId: true },
      distinct: ["workspaceId"],
    });

    const workspaceIds = workspaceRows.map((r) => r.workspaceId);
    logger.info(`Automation rule evaluation tick: ${workspaceIds.length} workspace(s) with rules`);

    let totalTriggered = 0;
    let totalEvaluated = 0;
    let totalErrors = 0;

    for (const workspaceId of workspaceIds) {
      try {
        const result = await evaluateRulesForWorkspace(workspaceId);
        totalEvaluated += result.rulesEvaluated;
        totalTriggered += result.triggered.length;
        totalErrors += result.errors;

        if (result.triggered.length > 0) {
          logger.info(
            `automationRuleWorker: workspace ${workspaceId} — ${result.triggered.length} rule(s) triggered, ${result.skippedCooldown} skipped (cooldown)`,
          );
        }
      } catch (err) {
        logger.error(`automationRuleWorker: failed evaluating rules for workspace ${workspaceId}`, err);
        captureError(err, { worker: "automationRuleWorker", workspaceId });
        totalErrors++;
      }
    }

    logger.info(
      `Automation rule evaluation complete: ${totalEvaluated} rule-campaign pairs evaluated, ${totalTriggered} triggered, ${totalErrors} error(s)`,
    );
  },
  { connection: redisConnection, concurrency: 1 },
);

worker.on("completed", () => logger.info("Automation rule evaluation tick completed"));
worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Automation rule evaluation job failed: ${job?.name}`, err);
  captureError(err, { worker: "automationRuleWorker", jobName: job?.name });
  if (job && isFinalFailure(job)) void sendToDeadLetter(AUTOMATION_RULE_QUEUE, job, err);
});

// Register the repeatable job — idempotent: BullMQ replaces an existing schedule with the
// same jobId rather than stacking duplicates, so restarting this worker is safe.
await automationRuleQueue.add(REPEATABLE_JOB_NAME, {}, { repeat: { every: EVALUATION_INTERVAL_MS }, jobId: REPEATABLE_JOB_NAME });

registerGracefulShutdown(worker, "automationRuleWorker");
logger.info(`Automation rule worker listening for jobs (every ${EVALUATION_INTERVAL_MS / 60000} minutes)`);
