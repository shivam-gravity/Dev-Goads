import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../infra/env.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

// Seeded in apps/api/prisma/seed.ts as a real WorkspaceMember (owner) of demo-workspace
// and demo-business's workspace — using the real seeded id (not a bare "demo" sentinel)
// means the dev bypass passes the SAME workspace-membership checks as a real user,
// instead of needing a special case carved out of every ownership check. Mirrors
// apps/auth-service/src/requireUser.ts's DEMO_USER_ID exactly, since both middlewares
// stand in for the same missing login flow.
const DEMO_USER_ID = "demo-user";

/**
 * Minimal bearer-token auth. In dev (no Authorization header + NODE_ENV !== "production")
 * requests pass through as the seeded demo user so the dashboard works without a login flow.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({ error: "Missing Authorization header" });
    }
    req.userId = DEMO_USER_ID;
    return next();
  }

  const token = header.replace(/^Bearer\s+/i, "");
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    req.userId = decoded.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
