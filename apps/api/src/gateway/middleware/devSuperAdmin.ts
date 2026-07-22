import { prisma } from "../../db/prisma.js";

/**
 * DEV-ONLY super-admin bypass. A single developer identity (DEV_SUPERADMIN_EMAIL, default
 * ssrivastava@example.com) is allowed to access every workspace/business without a membership
 * row — so local testing doesn't get blocked by "You do not have access to this workspace" when
 * hitting a workspace the dev account was never explicitly added to.
 *
 * Hard-gated to non-production: in production this always returns false, so the real
 * membership checks (requireWorkspaceMember/requireBusinessAccess) apply to everyone with no
 * exception. Resolves the email → userId once and caches it (dev DB rows don't change under us).
 */
const DEV_SUPERADMIN_EMAIL = (process.env.DEV_SUPERADMIN_EMAIL ?? "ssrivastava@example.com").toLowerCase();

let cachedId: string | null | undefined; // undefined = not resolved yet, null = no such user

async function resolveSuperAdminId(): Promise<string | null> {
  if (cachedId !== undefined) return cachedId;
  const user = await prisma.user.findFirst({ where: { email: DEV_SUPERADMIN_EMAIL }, select: { id: true } });
  cachedId = user?.id ?? null;
  return cachedId;
}

/** True only when NOT production AND the authenticated user is the configured dev super-admin. */
export async function isDevSuperAdmin(userId: string | undefined): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false;
  if (!userId) return false;
  const adminId = await resolveSuperAdminId();
  return adminId !== null && userId === adminId;
}
