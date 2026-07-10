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
export async function acquireLock(key: string, ttlMs: number): Promise<DistributedLock | null> {
  const token = randomUUID();
  const result = await redisClient.set(key, token, "PX", ttlMs, "NX");
  if (result !== "OK") return null;

  return {
    key,
    token,
    async release() {
      try {
        await redisClient.eval(RELEASE_SCRIPT, 1, key, token);
      } catch (err) {
        logger.warn(`Failed to release distributed lock ${key}`, err);
      }
    },
  };
}

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
