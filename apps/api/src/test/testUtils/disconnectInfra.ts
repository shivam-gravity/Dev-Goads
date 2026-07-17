import {
  leadIngestionQueue,
  creativeGenerationQueue,
  researchSessionQueue,
  researchOrchestratorQueue,
  metricsIngestionQueue,
  crmWebhookQueue,
  campaignGenerationQueue,
  competitorAdRefreshQueue,
} from "../../infra/queue.js";
import { redisClient } from "../../infra/redisClient.js";

/**
 * Single source of truth for "close every long-lived Redis connection this codebase's
 * test suite might have opened" — infra/queue.js eagerly opens a real connection per
 * BullMQ queue at module load (whether or not a test ever calls `.add()` on one), and
 * infra/redisClient.js's shared client (backing distributedLock.ts/redisStreamEventBus.ts)
 * connects lazily on first command (e.g. any code path that calls eventBus.publish, even
 * transitively). Any open handle among these keeps `node --test` hanging after the last
 * test finishes rather than exiting, regardless of whether the test's own assertions ever
 * touched that queue/client.
 *
 * Call this from an `after()` hook in any test file that imports — even transitively —
 * infra/queue.js or infra/eventBus.js/redisStreamEventBus.js/distributedLock.js. This one
 * function is the thing to update when a new queue is added, instead of each test file
 * hardcoding its own list (that's exactly how this went stale twice already — see git
 * history on metaLeadWebhook.test.ts).
 */
export async function disconnectTestInfra(): Promise<void> {
  await Promise.allSettled([
    leadIngestionQueue.disconnect(),
    creativeGenerationQueue.disconnect(),
    researchSessionQueue.disconnect(),
    researchOrchestratorQueue.disconnect(),
    metricsIngestionQueue.disconnect(),
    crmWebhookQueue.disconnect(),
    campaignGenerationQueue.disconnect(),
    competitorAdRefreshQueue.disconnect(),
    redisClient.disconnect(),
  ]);
}
