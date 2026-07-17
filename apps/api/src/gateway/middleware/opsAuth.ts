import type { NextFunction, Request, Response } from "express";

const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

/**
 * Gate for /api/ops/*: these routes surface cross-tenant infrastructure data (e.g. the
 * dead-letter queue has no workspaceId at all — it's one shared table across every
 * workspace's background jobs), so there is no per-workspace scoping to apply the way
 * requireWorkspaceMember/requireBusinessAccess do everywhere else. Any logged-in user
 * (including the dev-mode demo-user bypass in requireAuth) would otherwise see every
 * other workspace's failed-job payloads and error messages. Mirrors crmInternalAuth.ts's
 * shared-secret pattern for the same reason: some data genuinely isn't tenant-scoped, so
 * "logged in" isn't a sufficient gate — reuses INTERNAL_SERVICE_KEY (already the
 * platform's own trusted-caller secret) rather than inventing a new one.
 */
export function requireOpsAccess(req: Request, res: Response, next: NextFunction) {
  if (!INTERNAL_SERVICE_KEY) {
    console.error("INTERNAL_SERVICE_KEY is not set — refusing all /api/ops traffic until it's configured.");
    return res.status(500).json({ error: "Service misconfigured" });
  }
  if (req.header("x-internal-service-key") !== INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ error: "Direct access to this route is not permitted" });
  }
  next();
}
