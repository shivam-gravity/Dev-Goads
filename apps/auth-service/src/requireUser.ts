import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../../api/src/modules/auth/authService.js";

export interface UserRequest extends Request {
  userId?: string;
}

/**
 * End-user auth for this service, independent of internalServiceAuth (which only proves
 * the call came from the gateway, not who the end user is). Every /workspaces/* route
 * needs this — without it, any caller that reaches the gateway (or this port directly,
 * pre-internalServiceAuth-hardening notwithstanding) could read/write any workspace by id.
 */
export function requireUser(req: UserRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing auth" });
  try {
    req.userId = verifyToken(header.replace(/^Bearer\s+/i, "")).userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
