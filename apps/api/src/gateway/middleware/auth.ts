import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export interface AuthedRequest extends Request {
  apiKeyId?: string;
}

/**
 * Minimal bearer-token auth. In dev (no Authorization header + NODE_ENV !== "production")
 * requests pass through as an anonymous demo key so the dashboard works without a login flow.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({ error: "Missing Authorization header" });
    }
    req.apiKeyId = "demo";
    return next();
  }

  const token = header.replace(/^Bearer\s+/i, "");
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    req.apiKeyId = decoded.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
