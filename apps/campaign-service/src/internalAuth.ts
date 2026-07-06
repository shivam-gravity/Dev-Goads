import type { NextFunction, Request, Response } from "express";

const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

/**
 * This service trusts the gateway to have already authenticated the end user
 * (see requireAuth in apps/api/src/gateway/middleware/auth.ts) — it has no user-facing
 * auth of its own. Without this check, anyone who can reach this port directly
 * bypasses the gateway entirely. The gateway's proxy (apps/api/src/gateway/proxy.ts)
 * attaches the same key on every forwarded request.
 */
export function internalServiceAuth(req: Request, res: Response, next: NextFunction) {
  if (!INTERNAL_SERVICE_KEY) {
    console.warn("INTERNAL_SERVICE_KEY is not set — this service is accepting unauthenticated direct traffic.");
    return next();
  }
  if (req.header("x-internal-service-key") !== INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ error: "Direct access to this service is not permitted" });
  }
  next();
}
