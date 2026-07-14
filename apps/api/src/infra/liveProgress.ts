import { redisClient } from "./redisClient.js";
import { logger } from "../modules/logger/logger.js";

// Long enough to cover a slow end-to-end run (research + agents + build has taken up to a
// few minutes in live verification), short enough that a key nobody ever reads again
// doesn't linger — this is transient UI decoration, not the durable record of what ran
// (that's ProviderExecution/AgentResult, already persisted to Postgres regardless of this).
const PROGRESS_TTL_SECONDS = 15 * 60;

function keyFor(prefix: string, jobId: string): string {
  return `progress:${prefix}:${jobId}`;
}

/**
 * Appends one completed step's name to this job's live-progress list. A Redis list (RPUSH),
 * not a read-modify-write JSON blob, specifically because providers/agents settle
 * concurrently (Promise.all) — RPUSH is atomic per call, so parallel completions can't clobber
 * each other's writes the way a GET-then-SET would. Best-effort/fire-and-forget: a Redis
 * hiccup here must never fail the pipeline it's only decorating, so failures are swallowed
 * and logged, not thrown.
 */
export async function recordProgressStep(prefix: string, jobId: string, stepName: string): Promise<void> {
  try {
    const key = keyFor(prefix, jobId);
    await redisClient.rpush(key, stepName);
    await redisClient.expire(key, PROGRESS_TTL_SECONDS);
  } catch (err) {
    logger.warn(`recordProgressStep: failed to record "${stepName}" for ${prefix}:${jobId} — live progress UI will just show fewer steps`, err);
  }
}

/** Returns the completed step names in the order they finished, or [] if the key doesn't
 * exist (never started, already expired, or a Redis miss) — callers should treat an empty
 * result as "no live progress available" and fall back to their own static messaging rather
 * than treating it as an error. */
export async function getProgressSteps(prefix: string, jobId: string): Promise<string[]> {
  try {
    return await redisClient.lrange(keyFor(prefix, jobId), 0, -1);
  } catch {
    return [];
  }
}
