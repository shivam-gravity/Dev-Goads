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
