import { randomUUID } from "node:crypto";
import { redisClient } from "./redisClient.js";
import { logger } from "../modules/logger/logger.js";

export interface DistributedLock {
  key: string;
  token: string;
  release(): Promise<void>;
}

export class LockAlreadyHeldError extends Error {
  constructor(key: string) {
    super(`Lock already held: ${key}`);
    this.name = "LockAlreadyHeldError";
  }
}

// Only delete the key if its value still matches the token we set — without this check, a
// lock holder whose TTL already expired (and was re-acquired by a different holder in the
// meantime) could release the NEW holder's lock out from under it with a plain DEL.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** Single-instance Redis lock (SET NX PX + token-checked release) — not full Redlock
 * consensus, since this codebase runs against one Redis instance, not a cluster where a
 * lock could survive a single node's failure. Good enough to prevent the concrete race
 * this exists for (two BullMQ jobs processing the same business concurrently), not
 * intended as a general-purpose distributed-systems primitive beyond that. */
// Locks currently held by this process — tracked purely so a SIGTERM/SIGINT (e.g. a
// dev-server restart mid-run) can release them on the way out instead of leaving the
// Redis key stuck for its full TTL just because the process died before its own
// try/finally got a chance to run.
const activeLocks = new Set<DistributedLock>();

export async function acquireLock(key: string, ttlMs: number): Promise<DistributedLock | null> {
  const token = randomUUID();
  const result = await redisClient.set(key, token, "PX", ttlMs, "NX");
  if (result !== "OK") return null;

  const lock: DistributedLock = {
    key,
    token,
    async release() {
      activeLocks.delete(lock);
      try {
        await redisClient.eval(RELEASE_SCRIPT, 1, key, token);
      } catch (err) {
        logger.warn(`Failed to release distributed lock ${key}`, err);
      }
    },
  };
  activeLocks.add(lock);
  return lock;
}

// Registered once per process regardless of how many times this module is imported.
// Doesn't call process.exit itself — other SIGTERM/SIGINT listeners (see
// gracefulShutdown.ts) already own that decision; this just races the release against
// whatever grace period they allow before the process actually goes down.
let shutdownReleaseRegistered = false;
function registerShutdownRelease(): void {
  if (shutdownReleaseRegistered) return;
  shutdownReleaseRegistered = true;

  const releaseAllOnShutdown = (signal: string) => {
    if (activeLocks.size === 0) return;
    logger.info(`${signal}: releasing ${activeLocks.size} held distributed lock(s) before exit`);
    void Promise.all([...activeLocks].map((lock) => lock.release()));
  };

  process.on("SIGTERM", () => releaseAllOnShutdown("SIGTERM"));
  process.on("SIGINT", () => releaseAllOnShutdown("SIGINT"));
}
registerShutdownRelease();

/**
 * Acquires `key`, runs `fn`, always releases afterward (success or throw). Throws
 * LockAlreadyHeldError immediately rather than waiting/retrying — every current caller
 * (campaign generation) wants "reject the second concurrent attempt with a clear error,"
 * not "queue behind the first one," since queuing a duplicate request silently would hide
 * from the caller that they'd double-submitted.
 */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireLock(key, ttlMs);
  if (!lock) throw new LockAlreadyHeldError(key);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

export class LockWaitTimeoutError extends Error {
  constructor(key: string, waitedMs: number) {
    super(`Timed out after ${waitedMs}ms waiting for lock: ${key}`);
    this.name = "LockWaitTimeoutError";
  }
}

const LOCK_POLL_INTERVAL_MS = 500;

/**
 * Like withLock, but waits/retries for the lock instead of failing fast — for callers
 * where a second concurrent request should queue behind the first (e.g. two browser tabs
 * generating for the same business) rather than surface an error. Polls every
 * LOCK_POLL_INTERVAL_MS until acquired or maxWaitMs elapses, then throws
 * LockWaitTimeoutError — distinct from LockAlreadyHeldError, since here it's the wait
 * that failed, not the mere fact something else was running.
 */
export async function withQueuedLock<T>(key: string, ttlMs: number, maxWaitMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + maxWaitMs;
  let lock = await acquireLock(key, ttlMs);
  if (!lock) logger.info(`Waiting for lock ${key} (held by another run)...`);
  while (!lock) {
    if (Date.now() >= deadline) throw new LockWaitTimeoutError(key, maxWaitMs);
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
    lock = await acquireLock(key, ttlMs);
  }
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
