import { Queue, type ConnectionOptions } from "bullmq";

/**
 * Shared BullMQ queue for slow, multi-step work (AI image/video generation today;
 * campaign launch could move here too later). Backed by the Redis instance already
 * declared in docker-compose.yml but previously unused. Connection is passed as plain
 * host/port options rather than an ioredis instance — BullMQ bundles its own ioredis
 * internally, and importing the top-level `ioredis` package alongside it produces a
 * duplicate-package type conflict (two different `Redis` classes) with no runtime benefit.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export const redisConnection: ConnectionOptions = parseRedisUrl(REDIS_URL);

export const CREATIVE_GENERATION_QUEUE = "creative-generation";

export const creativeGenerationQueue = new Queue(CREATIVE_GENERATION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

/**
 * Handles both single-lead ingestion (job name "ingest-one", enqueued by the Meta
 * webhook so it can ack Meta within its short timeout) and full syncs (job name
 * "backfill", enqueued by the manual "Sync Recent Leads" trigger or a repeatable
 * poll) — one queue, distinguished by job name, since both are the same kind of
 * work (talk to Meta/Google, upsert leads) at different granularity.
 */
export const LEAD_INGESTION_QUEUE = "lead-ingestion";

export const leadIngestionQueue = new Queue(LEAD_INGESTION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

/** Deep web-search-backed research on a promotional URL — its own queue since it's an unrelated feature area from creative generation/lead ingestion, not a variant of either. No retries: a failed run can involve several real (billed) web searches already spent, so silently re-running it would double-spend rather than help. */
export const RESEARCH_SESSION_QUEUE = "research-session";

export const researchSessionQueue = new Queue(RESEARCH_SESSION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

/**
 * Powers the Live Insights Dashboard: a single repeatable job (registered once by
 * metricsIngestionWorker.ts at startup) fans out one ingest-metrics call per active
 * campaign on an interval, then runs the optimization pass on each so fresh data and
 * fresh AI suggestions land together.
 */
export const METRICS_INGESTION_QUEUE = "metrics-ingestion";

export const metricsIngestionQueue = new Queue(METRICS_INGESTION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

/**
 * Outbound deliveries to a workspace's configured CRM webhook URL (Stage E). Decoupled from
 * ingestLead()/etc. via this queue so a slow or down CRM endpoint can never add latency to
 * ingestion — see crmWebhookWorker.ts, which registers the custom backoffStrategy function
 * (30s/2m/10m/30m/2h) that `attempts`/`backoff` below drive. Failed jobs after all 5 attempts sit in
 * BullMQ's own "failed" set as the de facto dead-letter store — kept 30 days, longer than
 * other queues, since there's no separate delivery-log UI yet to surface them elsewhere.
 */
export const CRM_WEBHOOK_QUEUE = "crm-webhook";

export const crmWebhookQueue = new Queue(CRM_WEBHOOK_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "crm-webhook" },
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 30 * 24 * 60 * 60 },
  },
});
