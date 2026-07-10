import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import { prisma } from "../db/prisma.js";
import { logger } from "../modules/logger/logger.js";

/** True only on a job's LAST attempt failing — every worker's `.on("failed", ...)`
 * handler fires on every failed attempt, including ones BullMQ is about to retry, so
 * this gate is what turns "just failed" into "permanently failed, worth a DLQ entry." */
export function isFinalFailure(job: Job): boolean {
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}

/** Only what sendToDeadLetter actually needs — deliberately NOT the full BullMQ `Job`
 * type, so a caller whose job.data carries something that shouldn't land in a queryable
 * DB table (e.g. crmWebhookWorker's lead payload) can pass a redacted stand-in instead of
 * the real job. A real BullMQ Job satisfies this structurally with no changes needed. */
export interface DeadLetterJobLike {
  name: string;
  data: unknown;
  attemptsMade: number;
}

/**
 * Persists one permanently-failed job for later inspection — a queryable alternative to
 * BullMQ's own internal "failed" set, which lives only in Redis and isn't reachable
 * through this app's own API/DB. Never throws: a DLQ write failing shouldn't crash the
 * worker process that's already in the middle of handling a job failure. Callers whose
 * job.data may carry secrets/PII must redact before calling this — jobData is persisted
 * verbatim, with no redaction of its own (see crmWebhookWorker.ts for the pattern).
 */
export async function sendToDeadLetter(queue: string, job: DeadLetterJobLike, err: Error): Promise<void> {
  try {
    await prisma.deadLetterEntry.create({
      data: {
        id: randomUUID(),
        queue,
        jobName: job.name,
        jobData: (job.data ?? {}) as any,
        error: err.message,
        attemptsMade: job.attemptsMade,
      },
    });
    logger.warn(`Dead-lettered ${queue}/${job.name} after ${job.attemptsMade} attempt(s): ${err.message}`);
  } catch (persistErr) {
    logger.error(`Failed to persist dead-letter entry for queue ${queue}`, persistErr);
  }
}

export interface DeadLetterEntryRecord {
  id: string;
  queue: string;
  jobName: string;
  jobData: unknown;
  error: string;
  attemptsMade: number;
  failedAt: string;
}

export async function listDeadLetterEntries(queue?: string, limit = 50): Promise<DeadLetterEntryRecord[]> {
  const rows = await prisma.deadLetterEntry.findMany({
    where: queue ? { queue } : undefined,
    orderBy: { failedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    queue: r.queue,
    jobName: r.jobName,
    jobData: r.jobData,
    error: r.error,
    attemptsMade: r.attemptsMade,
    failedAt: r.failedAt.toISOString(),
  }));
}
