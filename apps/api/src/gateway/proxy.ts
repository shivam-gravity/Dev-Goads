import type { Request, RequestHandler, Response } from "express";
import { logger } from "../modules/logger/logger.js";

const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

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
    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          ...(INTERNAL_SERVICE_KEY ? { "X-Internal-Service-Key": INTERNAL_SERVICE_KEY } : {}),
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      });

      const contentType = upstream.headers.get("content-type");
      if (contentType) res.setHeader("content-type", contentType);
      res.status(upstream.status);
      res.send(await upstream.text());
    } catch (err) {
      logger.error(`Upstream ${baseUrl} unavailable for ${req.method} ${req.path}`, err);
      res.status(502).json({ error: `Upstream service unavailable: ${baseUrl}` });
    }
  };
}
