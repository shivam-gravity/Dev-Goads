import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../../api/src/modules/auth/authService.js";

export interface UserRequest extends Request {
  userId?: string;
}

// Seeded in apps/api/prisma/seed.ts specifically for this bypass — the login flow was
// removed from apps/web, so every non-production request is this one demo identity.
const DEMO_USER_ID = "demo-user";

/**
 * End-user auth for this service, independent of internalServiceAuth (which only proves
 * the call came from the gateway, not who the end user is). Every /workspaces/* route
 * needs this — without it, any caller that reaches the gateway (or this port directly,
 * pre-internalServiceAuth-hardening notwithstanding) could read/write any workspace by id.
 *
 * Mirrors the gateway's requireAuth (apps/api/src/gateway/middleware/auth.ts): in dev (no
 * Authorization header + NODE_ENV !== "production") the request resolves to the seeded demo
 * user rather than 401ing, since apps/web no longer has a login flow to obtain a real token.
 */
export function requireUser(req: UserRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({ error: "Missing auth" });
    }
    req.userId = DEMO_USER_ID;
    return next();
  }
  try {
    req.userId = verifyToken(header.replace(/^Bearer\s+/i, "")).userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
