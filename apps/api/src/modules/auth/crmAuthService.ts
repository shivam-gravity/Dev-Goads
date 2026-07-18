import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/prisma.js";
import { CRM_JWT_SHARED_SECRET } from "../../infra/env.js";
import { issueToken, type User } from "./authService.js";
import { issueRefreshToken } from "./refreshTokenService.js";
import { setMetaOAuthConnection, setGoogleManualConnection } from "../integrations/integrationService.js";

interface CrmMetaIntegration {
  adAccountId: string;
  accessToken: string;
  pageId?: string;
  pageAccessToken?: string;
}

interface CrmGoogleIntegration {
  customerId: string;
  developerToken: string;
  accessToken: string;
  refreshToken?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
}

interface CrmPayload {
  sub: string;
  email: string;
  name: string;
  businessId: string;
  businessName: string;
  websiteUrl?: string;
  partnerId?: string | null;
  role: "admin" | "business_record" | "user" | "partner";
  metaIntegration?: CrmMetaIntegration | null;
  googleIntegration?: CrmGoogleIntegration | null;
}

export interface CrmAuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
  workspaceId: string;
  businessId: string;
}

function crmRoleToWorkspaceRole(crmRole: CrmPayload["role"]): string {
  switch (crmRole) {
    case "admin": return "owner";
    case "business_record": return "admin";
    case "user": return "member";
    case "partner": return "viewer";
    default: return "member";
  }
}

export async function crmLogin(signedToken: string): Promise<CrmAuthResult> {
  const payload = jwt.verify(signedToken, CRM_JWT_SHARED_SECRET) as CrmPayload;

  const crmUserId = String(payload.sub);
  const email = payload.email.toLowerCase().trim();
  const name = payload.name?.trim() || email;
  const crmBusinessId = String(payload.businessId);
  const crmPartnerId = payload.partnerId ? String(payload.partnerId) : null;

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ crmUserId }, { email }] },
  });

  const userId = existingUser?.id ?? randomUUID();
  const now = new Date();

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { name, isExternal: true, crmUserId, crmBusinessId, crmPartnerId: crmPartnerId ?? undefined },
    });
  } else {
    await prisma.user.create({
      data: { id: userId, email, name, isExternal: true, crmUserId, crmBusinessId, crmPartnerId, createdAt: now },
    });
  }

  const workspaceId = `crm-biz-${crmBusinessId}`;
  const existingWorkspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });

  if (!existingWorkspace) {
    await prisma.workspace.create({
      data: { id: workspaceId, name: payload.businessName || "CRM Business", ownerId: userId, plan: "starter", createdAt: now },
    });
  }

  const existingMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId },
  });

  const role = crmRoleToWorkspaceRole(payload.role);
  if (!existingMember) {
    await prisma.workspaceMember.create({
      data: { id: randomUUID(), workspaceId, userId, role, invitedAt: now, joinedAt: now },
    });
  } else if (existingMember.role !== role) {
    await prisma.workspaceMember.update({ where: { id: existingMember.id }, data: { role } });
  }

  const businessId = `crm-biz-entity-${crmBusinessId}`;
  const existingBusiness = await prisma.business.findUnique({ where: { id: businessId } });

  if (!existingBusiness) {
    const domain = payload.websiteUrl ? new URL(payload.websiteUrl).hostname : undefined;
    await prisma.business.create({
      data: {
        id: businessId,
        workspaceId,
        domain,
        data: { name: payload.businessName, domain, createdAt: now.toISOString() },
        createdAt: now,
      },
    });
  }

  if (payload.metaIntegration?.accessToken) {
    await setMetaOAuthConnection(workspaceId, {
      accessToken: payload.metaIntegration.accessToken,
      expiresInSeconds: 60 * 24 * 60 * 60,
      adAccountId: payload.metaIntegration.adAccountId,
      adAccountName: payload.businessName || "CRM Ad Account",
      currency: "USD",
      pageId: payload.metaIntegration.pageId,
    });
  }

  if (payload.googleIntegration?.accessToken) {
    await setGoogleManualConnection(workspaceId, {
      customerId: payload.googleIntegration.customerId,
      developerToken: payload.googleIntegration.developerToken,
      accessToken: payload.googleIntegration.accessToken,
      refreshToken: payload.googleIntegration.refreshToken || undefined,
      clientId: payload.googleIntegration.clientId || undefined,
      clientSecret: payload.googleIntegration.clientSecret || undefined,
    });
  }

  const accessToken = issueToken(userId, workspaceId, businessId);
  const refreshToken = await issueRefreshToken(userId);

  const user: User = { id: userId, email, name, createdAt: (existingUser?.createdAt ?? now).toISOString() };
  return { user, accessToken, refreshToken, workspaceId, businessId };
}
