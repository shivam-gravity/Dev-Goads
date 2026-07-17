import { researchSessionQueue, crmWebhookQueue } from "../../infra/queue.js";
import { redisClient } from "../../infra/redisClient.js";

export async function disconnectTestInfra(): Promise<void> {
  await Promise.allSettled([
    researchSessionQueue.disconnect(),
    crmWebhookQueue.disconnect(),
    redisClient.disconnect(),
  ]);
}
