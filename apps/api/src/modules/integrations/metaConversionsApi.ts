import { createHash } from "node:crypto";
import { logger } from "../logger/logger.js";
import { getMetaCredentials } from "./integrationService.js";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ConversionEvent {
  eventName: string; // Purchase, Lead, AddToCart, etc.
  eventTime: number; // Unix timestamp
  eventSourceUrl?: string;
  actionSource: "website" | "app" | "phone_call" | "chat" | "email" | "other";
  userData: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    externalId?: string;
    clientIpAddress?: string;
    clientUserAgent?: string;
    fbc?: string; // Meta click ID
    fbp?: string; // Meta browser ID
  };
  customData?: {
    currency?: string;
    value?: number;
    contentName?: string;
    contentIds?: string[];
    contentType?: string;
    orderId?: string;
  };
  eventId?: string; // For deduplication with browser pixel
}

export interface CAPIResponse {
  eventsReceived: number;
  messages: string[];
  fbTraceId: string;
}

// ─── Hashing helpers ─────────────────────────────────────────────────────────

/**
 * SHA256-hashes a single value after normalizing (trim + lowercase).
 * Returns undefined if the input is falsy.
 */
function sha256(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Hashes all PII fields in userData according to Meta's Conversions API
 * requirements. Non-PII fields (client_ip_address, client_user_agent, fbc,
 * fbp) are passed through unhashed.
 */
export function hashUserData(userData: ConversionEvent["userData"]): Record<string, string | string[] | undefined> {
  return {
    em: sha256(userData.email),
    ph: sha256(userData.phone),
    fn: sha256(userData.firstName),
    ln: sha256(userData.lastName),
    ct: sha256(userData.city),
    st: sha256(userData.state),
    zp: sha256(userData.zipCode),
    country: sha256(userData.country),
    external_id: sha256(userData.externalId),
    client_ip_address: userData.clientIpAddress,
    client_user_agent: userData.clientUserAgent,
    fbc: userData.fbc,
    fbp: userData.fbp,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function buildEventPayload(event: ConversionEvent, testEventCode?: string): Record<string, any> {
  const hashedUserData = hashUserData(event.userData);

  // Strip undefined values from user_data so Meta doesn't reject the payload
  const cleanUserData: Record<string, any> = {};
  for (const [key, val] of Object.entries(hashedUserData)) {
    if (val !== undefined) cleanUserData[key] = val;
  }

  const payload: Record<string, any> = {
    event_name: event.eventName,
    event_time: event.eventTime,
    action_source: event.actionSource,
    user_data: cleanUserData,
  };

  if (event.eventSourceUrl) payload.event_source_url = event.eventSourceUrl;
  if (event.eventId) payload.event_id = event.eventId;

  if (event.customData) {
    const custom: Record<string, any> = {};
    if (event.customData.currency) custom.currency = event.customData.currency;
    if (event.customData.value !== undefined) custom.value = event.customData.value;
    if (event.customData.contentName) custom.content_name = event.customData.contentName;
    if (event.customData.contentIds) custom.content_ids = event.customData.contentIds;
    if (event.customData.contentType) custom.content_type = event.customData.contentType;
    if (event.customData.orderId) custom.order_id = event.customData.orderId;
    if (Object.keys(custom).length > 0) payload.custom_data = custom;
  }

  if (testEventCode) payload.test_event_code = testEventCode;

  return payload;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sends one or more server-side conversion events to Meta's Conversions API.
 * All PII in userData is SHA256-hashed before transmission.
 *
 * Falls back to a mock response when no live credentials are available for
 * the workspace.
 */
export async function sendConversionEvents(
  workspaceId: string,
  pixelId: string,
  events: ConversionEvent[],
): Promise<CAPIResponse> {
  const creds = await getMetaCredentials(workspaceId);
  if (!creds) {
    logger.info("[MetaConversionsApi] No credentials for workspace — returning mock CAPI response", { workspaceId, pixelId, eventCount: events.length });
    return {
      eventsReceived: events.length,
      messages: [],
      fbTraceId: "mock_trace_id",
    };
  }

  const data = events.map((event) => buildEventPayload(event));

  logger.info("[MetaConversionsApi] Sending conversion events to Meta CAPI", { pixelId, eventCount: events.length });

  const url = `${GRAPH_BASE}/${pixelId}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data,
      access_token: creds.accessToken,
    }),
  });

  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    const errMsg = json.error?.error_user_msg ?? json.error?.message ?? `HTTP ${res.status}`;
    logger.error("[MetaConversionsApi] CAPI request failed", new Error(errMsg), { pixelId });
    throw new Error(`Meta Conversions API error: ${errMsg}`);
  }

  logger.info("[MetaConversionsApi] CAPI events sent successfully", { pixelId, eventsReceived: json.events_received });

  return {
    eventsReceived: json.events_received ?? 0,
    messages: json.messages ?? [],
    fbTraceId: json.fbtrace_id ?? "",
  };
}

/**
 * Sends a test event to Meta's Conversions API with a test_event_code. Test
 * events appear in Meta Events Manager's "Test Events" tab without affecting
 * real reporting data.
 */
export async function sendTestEvent(
  workspaceId: string,
  pixelId: string,
  testEventCode: string,
): Promise<CAPIResponse> {
  const creds = await getMetaCredentials(workspaceId);
  if (!creds) {
    logger.info("[MetaConversionsApi] No credentials for workspace — returning mock test event response", { workspaceId, pixelId });
    return {
      eventsReceived: 1,
      messages: [],
      fbTraceId: "mock_trace_id",
    };
  }

  const testEvent: ConversionEvent = {
    eventName: "PageView",
    eventTime: Math.floor(Date.now() / 1000),
    eventSourceUrl: "https://example.com/test",
    actionSource: "website",
    userData: {
      email: "test@example.com",
      clientIpAddress: "0.0.0.0",
      clientUserAgent: "Mozilla/5.0 (Test Event)",
    },
  };

  const data = [buildEventPayload(testEvent, testEventCode)];

  logger.info("[MetaConversionsApi] Sending test event to Meta CAPI", { pixelId, testEventCode });

  const url = `${GRAPH_BASE}/${pixelId}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data,
      access_token: creds.accessToken,
      test_event_code: testEventCode,
    }),
  });

  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    const errMsg = json.error?.error_user_msg ?? json.error?.message ?? `HTTP ${res.status}`;
    logger.error("[MetaConversionsApi] Test event request failed", new Error(errMsg), { pixelId, testEventCode });
    throw new Error(`Meta Conversions API test event error: ${errMsg}`);
  }

  logger.info("[MetaConversionsApi] Test event sent successfully", { pixelId, testEventCode });

  return {
    eventsReceived: json.events_received ?? 0,
    messages: json.messages ?? [],
    fbTraceId: json.fbtrace_id ?? "",
  };
}
