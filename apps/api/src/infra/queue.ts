import { Queue, type ConnectionOptions } from "bullmq";

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

export const RESEARCH_SESSION_QUEUE = "research-session";

export const researchSessionQueue = new Queue(RESEARCH_SESSION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

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
