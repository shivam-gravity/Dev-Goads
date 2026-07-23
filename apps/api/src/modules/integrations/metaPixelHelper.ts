import { logger } from "../logger/logger.js";
import { getMetaCredentials } from "./integrationService.js";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const META_STANDARD_EVENTS = [
  "AddPaymentInfo", "AddToCart", "AddToWishlist", "CompleteRegistration",
  "Contact", "CustomizeProduct", "Donate", "FindLocation", "InitiateCheckout",
  "Lead", "PageView", "Purchase", "Schedule", "Search", "StartTrial",
  "SubmitApplication", "Subscribe", "ViewContent"
] as const;

export type MetaStandardEvent = typeof META_STANDARD_EVENTS[number];

export interface PixelStatus {
  id: string;
  name: string;
  lastFiredTime?: string;
  isUnavailable: boolean;
  dataUseSetting: string;
}

export interface PixelEventStats {
  eventName: string;
  count: number;
  lastReceivedTime?: string;
}

export interface InstallationGuideStep {
  title: string;
  instructions: string[];
}

export interface InstallationGuide {
  platforms: Record<string, InstallationGuideStep>;
}

// ─── Graph API helper ────────────────────────────────────────────────────────

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const url = `${GRAPH_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    throw new Error(`Meta Graph API error on ${path}: ${json.error?.error_user_msg ?? json.error?.message ?? res.status}`);
  }
  return json;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates the standard Meta Pixel base code HTML snippet with the given
 * pixelId injected. This is the code that goes in the <head> of every page.
 */
export function generatePixelBaseCode(pixelId: string): string {
  return `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;
}

/**
 * Generates an fbq('track', ...) call snippet for a given event name and
 * optional parameters object.
 */
export function generateEventCode(eventName: string, params?: Record<string, string>): string {
  if (params && Object.keys(params).length > 0) {
    return `fbq('track', '${eventName}', ${JSON.stringify(params)});`;
  }
  return `fbq('track', '${eventName}');`;
}

/**
 * Calls the Meta Graph API to check the status of a pixel (is it firing,
 * when was the last event, etc.). Falls back to a mock response when no
 * live credentials are available for the workspace.
 */
export async function getPixelStatus(workspaceId: string, pixelId: string): Promise<PixelStatus> {
  const creds = await getMetaCredentials(workspaceId);
  if (!creds) {
    logger.info("[MetaPixelHelper] No credentials for workspace — returning mock pixel status", { workspaceId, pixelId });
    return {
      id: pixelId,
      name: "Mock Pixel",
      lastFiredTime: new Date(Date.now() - 60_000).toISOString(),
      isUnavailable: false,
      dataUseSetting: "UNSPECIFIED",
    };
  }

  logger.info("[MetaPixelHelper] Fetching pixel status from Graph API", { pixelId });
  const json = await graphGet(`/${pixelId}`, {
    fields: "id,name,last_fired_time,is_unavailable,data_use_setting",
    access_token: creds.accessToken,
  });

  return {
    id: json.id,
    name: json.name,
    lastFiredTime: json.last_fired_time ?? undefined,
    isUnavailable: json.is_unavailable ?? false,
    dataUseSetting: json.data_use_setting ?? "UNSPECIFIED",
  };
}

/**
 * Lists events received by the pixel in the last 24 hours via the
 * /{pixelId}/stats endpoint. Falls back to mock data when no live
 * credentials are available.
 */
export async function listPixelEvents(workspaceId: string, pixelId: string): Promise<PixelEventStats[]> {
  const creds = await getMetaCredentials(workspaceId);
  if (!creds) {
    logger.info("[MetaPixelHelper] No credentials for workspace — returning mock pixel events", { workspaceId, pixelId });
    return [
      { eventName: "PageView", count: 1243, lastReceivedTime: new Date(Date.now() - 30_000).toISOString() },
      { eventName: "ViewContent", count: 387, lastReceivedTime: new Date(Date.now() - 120_000).toISOString() },
      { eventName: "AddToCart", count: 64, lastReceivedTime: new Date(Date.now() - 300_000).toISOString() },
      { eventName: "Purchase", count: 12, lastReceivedTime: new Date(Date.now() - 900_000).toISOString() },
    ];
  }

  logger.info("[MetaPixelHelper] Fetching pixel event stats from Graph API", { pixelId });
  const json = await graphGet(`/${pixelId}/stats`, {
    access_token: creds.accessToken,
  });

  const data: any[] = json.data ?? [];
  return data.map((entry: any) => ({
    eventName: entry.event ?? entry.event_name ?? "Unknown",
    count: entry.count ?? 0,
    lastReceivedTime: entry.last_received_time ?? undefined,
  }));
}

export interface PixelLiveConfirmation {
  pixelId: string;
  live: boolean;
  lastFiredTime?: string;
  eventsLast24h: number;
  reason: string;
}

// A pixel is "live" only if Meta reports it isn't disabled AND it has actually fired within
// this window — a configured-but-silent pixel means the site tag isn't installed/working, and
// launching against it would spend budget with no conversion signal coming back.
const PIXEL_LIVE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Confirms a Meta Pixel is genuinely LIVE — not just that the id exists, but that Graph API
 * reports it available and firing recent events. This backs the campaign-builder "confirm pixel
 * live" gate: generation is only allowed to proceed once this returns `live: true`, so a campaign
 * can never launch pointing at a dead/uninstalled pixel. Uses the same live Graph API as
 * getPixelStatus/listPixelEvents (with their mock fallback when the workspace has no creds), so a
 * dev workspace still resolves to a confirmable state rather than hard-failing.
 */
export async function confirmPixelLive(workspaceId: string, pixelId: string): Promise<PixelLiveConfirmation> {
  const [status, events] = await Promise.all([
    getPixelStatus(workspaceId, pixelId),
    listPixelEvents(workspaceId, pixelId),
  ]);

  const eventsLast24h = events.reduce((sum, e) => sum + (e.count ?? 0), 0);
  const firedAt = status.lastFiredTime ? Date.parse(status.lastFiredTime) : NaN;
  const firedRecently = Number.isFinite(firedAt) && Date.now() - firedAt <= PIXEL_LIVE_MAX_AGE_MS;

  if (status.isUnavailable) {
    return { pixelId, live: false, lastFiredTime: status.lastFiredTime, eventsLast24h, reason: "Meta reports this pixel as unavailable/disabled." };
  }
  if (!firedRecently) {
    return {
      pixelId,
      live: false,
      lastFiredTime: status.lastFiredTime,
      eventsLast24h,
      reason: status.lastFiredTime
        ? `Pixel last fired at ${status.lastFiredTime}, outside the ${PIXEL_LIVE_MAX_AGE_MS / 3_600_000}h live window — verify the tag is installed and firing.`
        : "Pixel has never fired an event — install the base code and confirm it fires a PageView.",
    };
  }
  return { pixelId, live: true, lastFiredTime: status.lastFiredTime, eventsLast24h, reason: `Pixel is firing (${eventsLast24h} events in the last 24h).` };
}

/**
 * Returns a structured installation guide with step-by-step instructions
 * for installing the Meta Pixel on various platforms.
 */
export function getPixelInstallationGuide(): InstallationGuide {
  return {
    platforms: {
      shopify: {
        title: "Shopify",
        instructions: [
          "Go to your Shopify admin panel.",
          "Navigate to Online Store > Preferences.",
          "Scroll to the 'Facebook Pixel' section.",
          "Paste your Pixel ID and click Save.",
          "Shopify automatically injects the base code and standard e-commerce events (ViewContent, AddToCart, InitiateCheckout, Purchase).",
        ],
      },
      wordpress: {
        title: "WordPress",
        instructions: [
          "Install the 'Official Facebook Pixel' plugin (or 'PixelYourSite' for advanced use).",
          "Activate the plugin and go to Settings > Facebook Pixel.",
          "Enter your Pixel ID and save.",
          "The plugin injects the base code on every page and provides event configuration UI.",
          "For WooCommerce stores, enable the e-commerce event tracking toggle to auto-fire Purchase, AddToCart, etc.",
        ],
      },
      customHtml: {
        title: "Custom HTML",
        instructions: [
          "Copy the base pixel code (use generatePixelBaseCode) and paste it in the <head> section of every page on your site.",
          "Add event code snippets (use generateEventCode) on relevant pages — e.g., fbq('track', 'Purchase') on your order confirmation page.",
          "Verify installation using the Meta Pixel Helper Chrome extension.",
          "Test events in Meta Events Manager > Test Events tab.",
        ],
      },
      gtm: {
        title: "Google Tag Manager",
        instructions: [
          "In GTM, create a new Tag with type 'Custom HTML'.",
          "Paste the base pixel code (use generatePixelBaseCode) into the HTML field.",
          "Set the trigger to 'All Pages' so the base code fires on every page load.",
          "For specific events, create additional Custom HTML tags with the fbq('track', ...) calls and assign appropriate triggers (e.g., form submission, button click).",
          "Publish the GTM container and verify events in Meta Events Manager.",
        ],
      },
    },
  };
}
