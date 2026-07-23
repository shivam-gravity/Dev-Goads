import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth.js";
import { getMembership } from "../../modules/workspace/workspaceService.js";
import { getBusiness } from "../../modules/business/businessService.js";
import { isDevSuperAdmin } from "./devSuperAdmin.js";

type IdSource = "params" | "body" | "query";

function readId(req: AuthedRequest, source: IdSource, key: string): string | undefined {
  const bag = req[source] as Record<string, unknown> | undefined;
  const value = bag?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Must run after requireAuth (needs req.userId) and before the route handler. Closes the
 * gap where every workspace-scoped route trusted whatever workspace id it was handed —
 * this actually checks req.userId is a WorkspaceMember of that workspace before letting
 * the request through.
 */
export function requireWorkspaceMember(source: IdSource, key = "id") {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const workspaceId = readId(req, source, key);
    if (!workspaceId) return res.status(400).json({ error: `Missing ${key}` });
    if (!req.userId) return res.status(401).json({ error: "Not authenticated" });

    if (await isDevSuperAdmin(req.userId)) return next(); // dev-only bypass; no-op in production
    const membership = await getMembership(workspaceId, req.userId);
    if (!membership) return res.status(403).json({ error: "You do not have access to this workspace" });
    next();
  };
}

/**
 * Same guarantee as requireWorkspaceMember, for routes scoped by businessId instead —
 * resolves Business.workspaceId first, then checks membership on that workspace. A
 * business with no workspaceId on record (created before this existed, or a data bug)
 * is treated as inaccessible rather than open to everyone, since there's no owner to
 * check against.
 */
export function requireBusinessAccess(source: IdSource, key = "id") {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const businessId = readId(req, source, key);
    if (!businessId) return res.status(400).json({ error: `Missing ${key}` });
    if (!req.userId) return res.status(401).json({ error: "Not authenticated" });

    const business = await getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    if (await isDevSuperAdmin(req.userId)) return next(); // dev-only bypass; no-op in production
    if (!business.workspaceId) return res.status(403).json({ error: "This business is not assigned to a workspace" });

    const membership = await getMembership(business.workspaceId, req.userId);
    if (!membership) return res.status(403).json({ error: "You do not have access to this business" });
    next();
  };
}
