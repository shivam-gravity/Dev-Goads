import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, COMPETITOR_AD_REFRESH_QUEUE, competitorAdRefreshQueue } from "../infra/queue.js";
import { prisma } from "../db/prisma.js";
import { discoverCompetitorAds } from "../research/ad-intelligence/CompetitorAdDiscovery.js";
import { analyzeNewCompetitorAds } from "../research/creative-intelligence/AdCreativeAnalyzer.js";
import { isFinalFailure, sendToDeadLetter } from "../infra/deadLetterQueue.js";
import { registerGracefulShutdown } from "../infra/gracefulShutdown.js";
import { logger } from "../modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "../infra/errorTracking.js";

initErrorTracking("polluxa-competitor-ad-refresh-worker");
registerCrashReporting("polluxa-competitor-ad-refresh-worker");

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const REPEATABLE_JOB_NAME = "refresh-due-competitor-ads";
/** On-demand single-competitor refresh — enqueued by POST /businesses/:id/competitors/:competitorId/refresh
 * (gateway/router.ts) as a manual override of the daily schedule above. */
const ON_DEMAND_JOB_NAME = "refresh-one-competitor";

const DAY_MS = 24 * 60 * 60 * 1000;

async function refreshOneCompetitor(competitor: { id: string; name: string }): Promise<void> {
  const discovery = await discoverCompetitorAds(competitor.id, competitor.name);
  const analyzed = await analyzeNewCompetitorAds(competitor.id);
  logger.info(
    `Competitor ${competitor.id} (${competitor.name}): ${discovery.adsSeen} ad(s) seen, ${discovery.adsDeactivated} deactivated, ${analyzed} newly analyzed`
  );
}

/** A competitor is due when it's never been enriched, or its last enrichment is older than
 * its own refreshIntervalDays — computed in application code rather than a single SQL
 * WHERE clause since the cutoff is per-row (refreshIntervalDays varies by competitor), not
 * a single fixed threshold every row shares. */
async function findCompetitorsDueForAdRefresh(): Promise<{ id: string; name: string }[]> {
  const active = await prisma.competitor.findMany({
    where: { status: "active" },
    select: { id: true, name: true, lastEnrichedAt: true, refreshIntervalDays: true },
  });
  const now = Date.now();
  return active
    .filter((c) => !c.lastEnrichedAt || now - c.lastEnrichedAt.getTime() >= c.refreshIntervalDays * DAY_MS)
    .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Standalone process — run with `npm run dev:competitor-ad-refresh-worker --workspace
 * apps/api` alongside the gateway, same pattern as metricsIngestionWorker.ts. On each daily
 * tick, finds every Competitor row due for an ad refresh (module 2's "refresh strategy"),
 * re-runs ad discovery for each (module 4), then analyzes any newly-discovered ads that
 * don't have a creative breakdown yet (module 5) — one worker covers both since analysis
 * only ever has new work when discovery just found something.
 */
const worker = new Worker(
  COMPETITOR_AD_REFRESH_QUEUE,
  async (job: Job) => {
    if (job.name === ON_DEMAND_JOB_NAME) {
      const { competitorId } = job.data as { competitorId: string };
      const competitor = await prisma.competitor.findUnique({ where: { id: competitorId }, select: { id: true, name: true } });
      if (!competitor) {
        logger.warn(`competitorAdRefreshWorker: on-demand refresh requested for unknown competitor ${competitorId}`);
        return;
      }
      await refreshOneCompetitor(competitor);
      return;
    }

    if (job.name !== REPEATABLE_JOB_NAME) {
      logger.warn(`competitorAdRefreshWorker: unknown job name "${job.name}"`);
      return;
    }

    const due = await findCompetitorsDueForAdRefresh();
    logger.info(`Competitor ad refresh tick: ${due.length} competitor(s) due`);

    for (const competitor of due) {
      try {
        await refreshOneCompetitor(competitor);
      } catch (err) {
        // One competitor's failure (a blocked scrape, a transient API error) shouldn't stop
        // the rest of this tick's fan-out from refreshing.
        logger.error(`Competitor ad refresh failed for competitor ${competitor.id}`, err);
        captureError(err, { worker: "competitorAdRefreshWorker", competitorId: competitor.id });
      }
    }
  },
  { connection: redisConnection, concurrency: 1 }
);

worker.on("completed", () => logger.info("Competitor ad refresh tick completed"));
worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Competitor ad refresh job failed: ${job?.name}`, err);
  captureError(err, { worker: "competitorAdRefreshWorker", jobName: job?.name });
  if (job && isFinalFailure(job)) void sendToDeadLetter(COMPETITOR_AD_REFRESH_QUEUE, job, err);
});

// Registering a repeatable job with the same jobId is idempotent — BullMQ replaces the
// existing schedule rather than stacking duplicates, so restarting this worker never
// produces multiple concurrent tickers.
await competitorAdRefreshQueue.add(REPEATABLE_JOB_NAME, {}, { repeat: { every: TICK_INTERVAL_MS }, jobId: REPEATABLE_JOB_NAME });

registerGracefulShutdown(worker, "competitorAdRefreshWorker");
logger.info(`Competitor ad refresh worker listening for jobs (every ${TICK_INTERVAL_MS / (60 * 60 * 1000)} hours)`);
