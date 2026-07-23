import { redisClient } from "./redisClient.js";
import { pushToWorkspace, pushToChannel, pushToBusiness } from "./websocketServer.js";
import { logger } from "../modules/logger/logger.js";

/**
 * The Real-Time Bridge: subscribes to Redis pub/sub channels and forwards events
 * to connected WebSocket clients. This bridges the gap between backend workers
 * (which publish events via Redis) and browsers (which receive via WebSocket).
 *
 * Uses Redis Pub/Sub (not Streams) for real-time push because:
 * - Fire-and-forget is correct here (if no browser is listening, drop the message)
 * - Streams guarantee at-least-once delivery via consumer groups, which is overkill
 *   for ephemeral UI updates — the client will re-fetch state on reconnect anyway
 * - Pub/Sub is lower latency (no ACK overhead, no consumer group coordination)
 *
 * Workers publish via `publishRealtimeEvent()` (exported below). The subscriber
 * connection runs in the gateway process alongside the WebSocket server.
 */

const REALTIME_PREFIX = "rt:";

export type RealtimeChannel =
  | "campaign.progress"       // Campaign generation pipeline steps
  | "campaign.status"         // Campaign status changes (active, paused, completed)
  | "insights.update"         // Live performance metrics refresh
  | "optimization.action"     // AI optimization decisions (budget shift, pause, fatigue)
  | "notification"            // New notifications
  | "automation.trigger"      // Automation rule triggered
  | "lead.new"               // New lead captured
  | "creative.ready"         // AI creative generation complete
  | "chat.stream"            // Streaming chat response chunks
  | "token.expiring";        // Meta token expiry warning

export interface RealtimeEvent {
  channel: RealtimeChannel;
  workspaceId?: string;
  businessId?: string;
  jobId?: string;
  payload: unknown;
}

/**
 * Publish a real-time event from any process (gateway, worker, etc.).
 * Events are broadcast via Redis Pub/Sub to whichever gateway instance
 * holds the WebSocket connection for the target workspace/client.
 */
export async function publishRealtimeEvent(event: RealtimeEvent): Promise<void> {
  try {
    const channelKey = event.jobId
      ? `${REALTIME_PREFIX}${event.channel}:${event.jobId}`
      : `${REALTIME_PREFIX}${event.channel}`;
    await redisClient.publish(channelKey, JSON.stringify(event));
  } catch (err) {
    logger.warn("Failed to publish realtime event", err);
  }
}

/**
 * Starts the subscriber that listens for all realtime events and pushes
 * them to WebSocket clients. Called once at gateway startup.
 */
export function startRealtimeBridge(): () => void {
  const subscriber = redisClient.duplicate();

  subscriber.psubscribe(`${REALTIME_PREFIX}*`, (err) => {
    if (err) {
      logger.error("Failed to subscribe to realtime channels", err);
      return;
    }
    logger.info("Real-time bridge: subscribed to all rt:* channels");
  });

  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    try {
      const event: RealtimeEvent = JSON.parse(message);
      const wsChannel = channel.replace(REALTIME_PREFIX, "");

      if (event.workspaceId) {
        pushToWorkspace(event.workspaceId, wsChannel, event.payload);
      } else if (event.businessId) {
        pushToBusiness(event.businessId, wsChannel, event.payload);
      } else {
        pushToChannel(wsChannel, event.payload);
      }
    } catch (err) {
      logger.warn("Failed to process realtime message", err);
    }
  });

  return () => {
    subscriber.punsubscribe(`${REALTIME_PREFIX}*`);
    subscriber.disconnect();
  };
}

// ── Convenience publishers for common events ──────────────────────────────────

export function emitCampaignProgress(jobId: string, step: string, phase: string, progress: number): Promise<void> {
  return publishRealtimeEvent({
    channel: "campaign.progress",
    jobId,
    payload: { step, phase, progress, timestamp: Date.now() },
  });
}

export function emitCampaignStatus(workspaceId: string, campaignId: string, status: string): Promise<void> {
  return publishRealtimeEvent({
    channel: "campaign.status",
    workspaceId,
    payload: { campaignId, status, timestamp: Date.now() },
  });
}

export function emitInsightsUpdate(workspaceId: string, campaignId: string, metrics: unknown): Promise<void> {
  return publishRealtimeEvent({
    channel: "insights.update",
    workspaceId,
    payload: { campaignId, metrics, timestamp: Date.now() },
  });
}

export function emitOptimizationAction(workspaceId: string, action: string, details: unknown): Promise<void> {
  return publishRealtimeEvent({
    channel: "optimization.action",
    workspaceId,
    payload: { action, details, timestamp: Date.now() },
  });
}

export function emitNotification(workspaceId: string, notification: unknown): Promise<void> {
  return publishRealtimeEvent({
    channel: "notification",
    workspaceId,
    payload: notification,
  });
}

export function emitAutomationTrigger(workspaceId: string, ruleId: string, campaignId: string, action: string, metricValue: number): Promise<void> {
  return publishRealtimeEvent({
    channel: "automation.trigger",
    workspaceId,
    payload: { ruleId, campaignId, action, metricValue, timestamp: Date.now() },
  });
}

export function emitNewLead(workspaceId: string, lead: unknown): Promise<void> {
  return publishRealtimeEvent({
    channel: "lead.new",
    workspaceId,
    payload: lead,
  });
}

export function emitCreativeReady(workspaceId: string, creativeId: string, url: string): Promise<void> {
  return publishRealtimeEvent({
    channel: "creative.ready",
    workspaceId,
    payload: { creativeId, url, timestamp: Date.now() },
  });
}

export function emitChatChunk(jobId: string, chunk: string, done: boolean): Promise<void> {
  return publishRealtimeEvent({
    channel: "chat.stream",
    jobId,
    payload: { chunk, done, timestamp: Date.now() },
  });
}

export function emitTokenExpiring(workspaceId: string, platform: string, daysRemaining: number): Promise<void> {
  return publishRealtimeEvent({
    channel: "token.expiring",
    workspaceId,
    payload: { platform, daysRemaining, timestamp: Date.now() },
  });
}
