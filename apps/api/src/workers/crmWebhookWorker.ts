import "dotenv/config";
import { createHmac } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { redisConnection, CRM_WEBHOOK_QUEUE } from "../infra/queue.js";
import { getCrmWebhookConfig } from "../modules/crm/crmWebhookService.js";
import { logger } from "../modules/logger/logger.js";

// 30s, 2m, 10m, 30m, 2h — matches the queue's `attempts: 5` in infra/queue.ts.
const CRM_WEBHOOK_BACKOFF_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];

interface CrmWebhookJobData {
  workspaceId: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Standalone process — run with `npm run dev:crm-webhook-worker --workspace apps/api`
 * alongside the gateway, same pattern as metricsIngestionWorker.ts/leadIngestionWorker.ts.
 * Delivers outbound CRM webhook events (Stage E) enqueued by crmWebhookService.dispatchCrmWebhook.
 */
const worker = new Worker<CrmWebhookJobData>(
  CRM_WEBHOOK_QUEUE,
  async (job: Job<CrmWebhookJobData>) => {
    const { workspaceId, event, payload } = job.data;

    // Re-read the config at delivery time (not at enqueue time) — a secret rotated or a URL
    // cleared after this job was queued should take effect on every attempt, not just the first.
    const config = await getCrmWebhookConfig(workspaceId);
    if (!config) return;

    const body = JSON.stringify({
      event,
      version: "v1",
      workspace_id: workspaceId,
      sent_at: new Date().toISOString(),
      data: payload,
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.secret) {
      headers["x-adgo-signature-256"] = `sha256=${createHmac("sha256", config.secret).update(body).digest("hex")}`;
    }

    const startedAt = Date.now();
    const res = await fetch(config.url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      logger.warn(`crm webhook delivery failed workspace=${workspaceId} event=${event} status=${res.status} durationMs=${durationMs}`);
      throw new Error(`CRM webhook delivery failed with status ${res.status}`);
    }
    logger.info(`crm webhook delivered workspace=${workspaceId} event=${event} status=${res.status} durationMs=${durationMs}`);
  },
  {
    connection: redisConnection,
    settings: {
      backoffStrategy: (attemptsMade: number) => CRM_WEBHOOK_BACKOFF_DELAYS_MS[attemptsMade - 1] ?? -1,
    },
  }
);

worker.on("failed", (job: Job | undefined, err: Error) =>
  logger.error(`crm webhook job failed workspace=${job?.data?.workspaceId} event=${job?.data?.event}`, err)
);

logger.info("CRM webhook worker listening for jobs");
