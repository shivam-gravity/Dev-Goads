// Named import, not default — ioredis's type declarations re-export the class both ways
// ("export { default }" and "export { default as Redis }"), but under this project's
// NodeNext module resolution the default-import path resolves to a non-constructable
// type (a known ioredis+NodeNext friction point). The named import resolves correctly.
import { Redis, type RedisOptions } from "ioredis";

/**
 * A plain ioredis client for commands BullMQ's own Queue/Worker API doesn't expose
 * (SET NX PX for distributed locks, XADD/XREADGROUP for Redis Streams). Deliberately
 * separate from BullMQ's internal Redis connections rather than reaching into BullMQ's
 * internals to share one — queue.ts's `redisConnection` is typed against BullMQ's own
 * *bundled* ioredis copy, which TypeScript treats as a nominally distinct `RedisOptions`
 * from this top-level package's, even though the shape is identical — so REDIS_URL is
 * parsed again here (a few lines of duplication) rather than importing that value and
 * fighting the resulting cross-package type error.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
    // Don't open a socket just because some module imported this file — several call
    // sites (e.g. campaignGenerationPipeline.ts) import distributedLock.ts, which
    // imports this, even in tests that fake withLock out entirely and never issue a
    // real command. Without this, importing the module graph alone opens a TCP
    // connection that keeps the process alive until something explicitly quits it.
    lazyConnect: true,
  };
}

export const redisClient = new Redis(parseRedisUrl(REDIS_URL));
