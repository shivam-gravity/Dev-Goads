import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { logger } from "../modules/logger/logger.js";

export interface WsClient {
  ws: WebSocket;
  workspaceId: string;
  businessId?: string;
  subscribedChannels: Set<string>;
  lastPing: number;
}

const clients = new Map<WebSocket, WsClient>();

const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

/**
 * Attaches a WebSocket server to the existing HTTP server (same port as Express).
 * Clients connect to ws://host:port/ws?workspaceId=X&businessId=Y and receive
 * pushed events for their workspace/business without polling.
 *
 * Protocol:
 * - Client -> Server: JSON { type: "subscribe", channel: "campaign.progress:jobId" }
 * - Client -> Server: JSON { type: "unsubscribe", channel: "..." }
 * - Client -> Server: JSON { type: "ping" }
 * - Server -> Client: JSON { type: "event", channel: "...", payload: {...} }
 * - Server -> Client: JSON { type: "pong" }
 */
export function attachWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const workspaceId = url.searchParams.get("workspaceId") ?? "unknown";
    const businessId = url.searchParams.get("businessId") ?? undefined;

    const client: WsClient = { ws, workspaceId, businessId, subscribedChannels: new Set(), lastPing: Date.now() };
    clients.set(ws, client);

    logger.info(`WebSocket connected: workspace=${workspaceId}, business=${businessId}`);

    ws.on("message", (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        handleClientMessage(client, msg);
      } catch {
        // Malformed JSON — ignore
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      logger.info(`WebSocket disconnected: workspace=${workspaceId}`);
    });

    ws.on("error", (err) => {
      logger.error(`WebSocket error for workspace=${workspaceId}`, err);
      clients.delete(ws);
    });

    ws.on("pong", () => {
      client.lastPing = Date.now();
    });

    // Send welcome
    sendToClient(ws, { type: "connected", workspaceId, timestamp: Date.now() });
  });

  // Heartbeat: detect dead connections
  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (Date.now() - client.lastPing > HEARTBEAT_INTERVAL_MS + PONG_TIMEOUT_MS) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  logger.info("WebSocket server attached at /ws");
  return wss;
}

function handleClientMessage(client: WsClient, msg: { type: string; channel?: string }) {
  switch (msg.type) {
    case "subscribe":
      if (msg.channel) client.subscribedChannels.add(msg.channel);
      break;
    case "unsubscribe":
      if (msg.channel) client.subscribedChannels.delete(msg.channel);
      break;
    case "ping":
      sendToClient(client.ws, { type: "pong", timestamp: Date.now() });
      break;
  }
}

function sendToClient(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Push an event to all connected clients that:
 * 1. Belong to the given workspaceId (or workspaceId is "*" for broadcast), AND
 * 2. Are subscribed to the given channel (or channel matches a wildcard subscription)
 */
export function pushToWorkspace(workspaceId: string, channel: string, payload: unknown): void {
  for (const [, client] of clients) {
    if (workspaceId !== "*" && client.workspaceId !== workspaceId) continue;
    if (!isSubscribed(client, channel)) continue;
    sendToClient(client.ws, { type: "event", channel, payload, timestamp: Date.now() });
  }
}

/**
 * Push to all clients subscribed to a channel regardless of workspace.
 * Useful for job-specific progress channels like "campaign.progress:jobId".
 */
export function pushToChannel(channel: string, payload: unknown): void {
  for (const [, client] of clients) {
    if (!isSubscribed(client, channel)) continue;
    sendToClient(client.ws, { type: "event", channel, payload, timestamp: Date.now() });
  }
}

/**
 * Push to all clients for a specific business.
 */
export function pushToBusiness(businessId: string, channel: string, payload: unknown): void {
  for (const [, client] of clients) {
    if (client.businessId !== businessId) continue;
    if (!isSubscribed(client, channel)) continue;
    sendToClient(client.ws, { type: "event", channel, payload, timestamp: Date.now() });
  }
}

function isSubscribed(client: WsClient, channel: string): boolean {
  if (client.subscribedChannels.has(channel)) return true;
  // Wildcard: subscribing to "campaign.progress" matches "campaign.progress:abc123"
  for (const sub of client.subscribedChannels) {
    if (channel.startsWith(sub + ":") || channel.startsWith(sub + ".")) return true;
  }
  return false;
}

/** Returns current connection count (for health/metrics). */
export function getActiveConnectionCount(): number {
  return clients.size;
}
