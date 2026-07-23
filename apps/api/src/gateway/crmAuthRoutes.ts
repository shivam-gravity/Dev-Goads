import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "./asyncHandler.js";
import { sendError } from "./errorResponse.js";
import { prisma } from "../db/prisma.js";
import { externalLogin } from "../modules/auth/crmAuthService.js";
import { rotateRefreshToken } from "../modules/auth/refreshTokenService.js";
import { issueToken } from "../modules/auth/authService.js";

/**
 * Federated auth surface for the sales_tech CRM. Mounted at /api/crm behind crmInternalAuth
 * (shared secret), so these are server-to-server only — never called from a browser. Kept as
 * gateway-LOCAL routes (calling authService directly) rather than proxied to auth-service,
 * because the gateway proxy forwards only Authorization + INTERNAL_SERVICE_KEY and would drop
 * the x-internal-service-key header the CRM authenticates with (see proxy.ts).
 */
export const crmAuthRoutes = Router();

const externalLoginSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  source: z.literal("crm"),
  externalUserId: z.string().min(1),
  businessId: z.string().optional(),
  partnerId: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

crmAuthRoutes.post(
  "/auth/external-login",
  asyncHandler(async (req, res) => {
    const parsed = externalLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, new Error("Invalid external-login payload"), 400, "Invalid external-login payload");
    }
    try {
      const result = await externalLogin(parsed.data);
      res.json(result);
    } catch (err) {
      sendError(res, err, 400, "External login failed");
    }
  })
);

crmAuthRoutes.post(
  "/auth/refresh",
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, new Error("refreshToken is required"), 400, "refreshToken is required");
    }
    try {
      // Mirrors the main gateway's /auth/refresh (router.ts): rotate the refresh token, then
      // mint a fresh access token scoped to the user's first workspace. There's no standalone
      // `refresh` helper — rotateRefreshToken is the primitive both entry points build on.
      const { newPlaintext, userId } = await rotateRefreshToken(parsed.data.refreshToken);
      const member = await prisma.workspaceMember.findFirst({ where: { userId }, orderBy: { joinedAt: "asc" } });
      const accessToken = issueToken(userId, member?.workspaceId);
      res.json({ accessToken, refreshToken: newPlaintext });
    } catch (err) {
      sendError(res, err, 401, "Invalid or expired refresh token");
    }
  })
);
