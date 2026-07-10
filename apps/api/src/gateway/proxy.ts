import type { Request, RequestHandler, Response } from "express";
import { logger } from "../modules/logger/logger.js";

const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

// Generous relative to the auth/campaign services' typical DB-backed request handling —
// long enough that a legitimately slow (not hung) upstream call still succeeds.
const PROXY_TIMEOUT_MS = 10_000;

// Only GET/HEAD are safe to retry automatically: they're idempotent by definition, so a
// retry after a timeout/network error can't duplicate a side effect. POST/PATCH/DELETE
// (e.g. "launch campaign", "create campaign") get ONE attempt and a clear error on
// failure — we can't know whether the upstream already processed the first attempt
// before the connection dropped, so silently retrying could double-launch a campaign.
// Retrying that safely would need an idempotency key the downstream service checks,
// which doesn't exist yet.
const RETRIABLE_METHODS = new Set(["GET", "HEAD"]);
const RETRY_DELAYS_MS = [250, 750];
const RETRIABLE_STATUS_CODES = new Set([502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Forwards a request to an extracted service (auth-service, campaign-service) and
 * relays its response verbatim. Routes proxied this way are handled entirely by
 * the downstream service — the gateway just forwards method/path/body and streams
 * the response back, matching the exact route path the service itself exposes.
 *
 * Attaches INTERNAL_SERVICE_KEY so the downstream service's internalServiceAuth
 * middleware can distinguish gateway traffic from someone hitting its port directly.
 */
export function proxyTo(baseUrl: string): RequestHandler {
  return async (req: Request, res: Response) => {
    const upstreamUrl = `${baseUrl}${req.path}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
    const canRetry = RETRIABLE_METHODS.has(req.method);
    const maxAttempts = canRetry ? RETRY_DELAYS_MS.length + 1 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const upstream = await fetch(upstreamUrl, {
          method: req.method,
          headers: {
            "Content-Type": "application/json",
            ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
            ...(INTERNAL_SERVICE_KEY ? { "X-Internal-Service-Key": INTERNAL_SERVICE_KEY } : {}),
          },
          body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
          signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        });

        if (canRetry && RETRIABLE_STATUS_CODES.has(upstream.status) && attempt < maxAttempts) {
          logger.warn(`Upstream ${baseUrl} returned ${upstream.status} for ${req.method} ${req.path} — retrying (attempt ${attempt}/${maxAttempts})`);
          await sleep(RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }

        const contentType = upstream.headers.get("content-type");
        if (contentType) res.setHeader("content-type", contentType);
        res.status(upstream.status);
        res.send(await upstream.text());
        return;
      } catch (err) {
        if (canRetry && attempt < maxAttempts) {
          logger.warn(`Upstream ${baseUrl} unreachable for ${req.method} ${req.path} — retrying (attempt ${attempt}/${maxAttempts})`, err);
          await sleep(RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }
        logger.error(`Upstream ${baseUrl} unavailable for ${req.method} ${req.path}`, err);
        res.status(502).json({ error: `Upstream service unavailable: ${baseUrl}` });
        return;
      }
    }
  };
}
