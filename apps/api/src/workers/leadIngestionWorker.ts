import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, LEAD_INGESTION_QUEUE } from "../infra/queue.js";
import { ingestMetaLead, backfillMetaLeads } from "../modules/leadgen/metaLeadSync.js";
import { syncGoogleLeadForms, syncGoogleLeadSubmissions } from "../modules/leadgen/googleLeadSyncService.js";
import { updateIntegrationSettings } from "../modules/integrations/integrationService.js";
import { logger } from "../modules/logger/logger.js";

type IngestOneJob = { name: "ingest-one"; data: { workspaceId: string; leadgenId: string } };
type BackfillJob = { name: "backfill"; data: { workspaceId: string; platform: "meta" | "google" } };

/**
 * Standalone process — run with `npm run dev:lead-worker --workspace apps/api` alongside
 * the gateway, same pattern as creativeGenerationWorker.ts. Handles both the fast
 * per-lead webhook path and the slower full-form backfill/poll path.
 */
const worker = new Worker(
  LEAD_INGESTION_QUEUE,
  async (job: Job) => {
    if (job.name === "ingest-one") {
      const { workspaceId, leadgenId } = job.data as IngestOneJob["data"];
      await ingestMetaLead(workspaceId, leadgenId);
      return;
    }

    if (job.name === "backfill") {
      const { workspaceId, platform } = job.data as BackfillJob["data"];
      if (platform === "meta") {
        await backfillMetaLeads(workspaceId);
      } else {
        await syncGoogleLeadForms(workspaceId);
        await syncGoogleLeadSubmissions(workspaceId);
      }
      await updateIntegrationSettings(workspaceId, platform, { lastLeadSyncAt: new Date().toISOString() });
      return;
    }

    logger.warn(`leadIngestionWorker: unknown job name "${job.name}"`);
  },
  { connection: redisConnection, concurrency: 3 }
);

worker.on("completed", (job: Job) => logger.info(`Lead ingestion job completed: ${job.name} ${JSON.stringify(job.data)}`));
worker.on("failed", (job: Job | undefined, err: Error) => logger.error(`Lead ingestion job failed: ${job?.name} ${JSON.stringify(job?.data)}`, err));

logger.info("Lead ingestion worker listening for jobs");
