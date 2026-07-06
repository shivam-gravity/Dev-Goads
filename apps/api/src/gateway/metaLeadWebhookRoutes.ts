import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { asyncHandler } from "./asyncHandler.js";
import { logger } from "../modules/logger/logger.js";
import { resolveWorkspaceIdForMetaPage } from "../modules/leadgen/metaLeadSync.js";
import { leadIngestionQueue } from "../infra/queue.js";

const META_APP_SECRET = process.env.META_APP_SECRET;
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;

export const metaLeadWebhookRoutes = Router();

export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * Meta's webhook subscription handshake — it GETs this URL once with a challenge and
 * expects the raw challenge string echoed back, but only if our verify token matches
 * what we told Meta when subscribing.
 */
metaLeadWebhookRoutes.get(
  "/leadgen",
  (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && META_WEBHOOK_VERIFY_TOKEN && token === META_WEBHOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }
    res.sendStatus(403);
  }
);

export function isValidSignature(req: RequestWithRawBody): boolean {
  if (!META_APP_SECRET) {
    logger.warn("META_APP_SECRET not set — rejecting Meta webhook delivery (cannot verify signature)");
    return false;
  }
  const header = req.header("x-hub-signature-256");
  if (!header || !req.rawBody) return false;

  const expected = `sha256=${createHmac("sha256", META_APP_SECRET).update(req.rawBody).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Real leadgen event delivery. Verifies the HMAC signature over the raw body (see the
 * `verify` callback on express.json() in index.ts, which stashes req.rawBody before
 * parsing), then enqueues one ingestion job per lead and acks immediately — Meta expects
 * a fast 200 and will retry deliveries that time out or come back non-2xx.
 */
metaLeadWebhookRoutes.post(
  "/leadgen",
  asyncHandler(async (req: RequestWithRawBody, res) => {
    if (!isValidSignature(req)) {
      res.sendStatus(401);
      return;
    }

    const entries = req.body?.entry ?? [];
    for (const entry of entries) {
      const pageId = entry.id;
      const workspaceId = pageId ? await resolveWorkspaceIdForMetaPage(pageId) : null;
      if (!workspaceId) {
        logger.warn(`Meta leadgen webhook: no connected workspace found for page ${pageId}`);
        continue;
      }
      for (const change of entry.changes ?? []) {
        if (change.field !== "leadgen") continue;
        const leadgenId = change.value?.leadgen_id;
        if (!leadgenId) continue;
        await leadIngestionQueue.add("ingest-one", { workspaceId, leadgenId });
      }
    }

    res.sendStatus(200);
  })
);
