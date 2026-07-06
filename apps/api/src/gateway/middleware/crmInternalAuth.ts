import type { NextFunction, Request, Response } from "express";

const CRM_INTERNAL_SERVICE_KEY = process.env.CRM_INTERNAL_SERVICE_KEY;

/**
 * Gate for /api/crm/*: these routes are called server-to-server by sales_tech_backend
 * (the CRM's Django backend), never directly by a browser — so there's no per-user
 * bearer token here, just a shared secret proving the call came from that backend.
 * Deliberately a separate check from requireAuth (browser-facing JWT) and from
 * INTERNAL_SERVICE_KEY (intra-monorepo services) — this crosses a repo/company
 * boundary and its own key can be rotated independently of either.
 */
export function crmInternalAuth(req: Request, res: Response, next: NextFunction) {
  if (!CRM_INTERNAL_SERVICE_KEY) {
    console.warn("CRM_INTERNAL_SERVICE_KEY is not set — /api/crm is accepting unauthenticated direct traffic.");
    return next();
  }
  if (req.header("x-internal-service-key") !== CRM_INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ error: "Direct access to this route is not permitted" });
  }
  next();
}
