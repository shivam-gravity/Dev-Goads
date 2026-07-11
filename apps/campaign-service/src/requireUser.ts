import type { NextFunction, Response } from "express";
import { verifyToken } from "../../api/src/modules/auth/authService.js";
import type { AuthedRequest } from "../../api/src/gateway/middleware/auth.js";

// Mirrors apps/auth-service/src/requireUser.ts exactly (same DEMO_USER_ID, same dev-mode
// bypass rationale — apps/web has no login flow to obtain a real token from). Sets
// req.userId (not a campaign-service-specific field name) so requireWorkspaceMember /
// requireBusinessAccess from apps/api/src/gateway/middleware/workspaceAccess.js can be
// reused here unchanged instead of reimplementing the same check a third time.
const DEMO_USER_ID = "demo-user";

export function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
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
