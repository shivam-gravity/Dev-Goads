import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/prisma.js";
import { CRM_JWT_SHARED_SECRET } from "../../infra/env.js";
import { issueToken, type User } from "./authService.js";
import { issueRefreshToken } from "./refreshTokenService.js";
import { setMetaOAuthConnection, setGoogleManualConnection } from "../integrations/integrationService.js";
import { fetchAdAccountCurrency } from "../integrations/metaOAuth.js";

interface CrmMetaIntegration {
  adAccountId: string;
  accessToken: string;
  pageId?: string;
  pageAccessToken?: string;
  /** Remaining lifetime of accessToken as reported by the CRM. When absent we assume a
   * long-lived (60-day) token; see the crmLogin handoff for why hardcoding that was a bug. */
  expiresInSeconds?: number;
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

export interface ExternalLoginInput {
  email: string;
  name?: string;
  source?: string;
  externalUserId?: string;
  businessId?: string;
  businessName?: string;
  websiteUrl?: string;
  partnerId?: string | null;
}

/**
 * Shared-secret external login for the CRM data-plane proxy (sales_tech_backend/
 * integration/devgoads_proxy.py). Unlike crmLogin (a signed-JWT browser SSO), this is a
 * server-to-server call under /api/crm (x-internal-service-key) that maps a CRM identity to a
 * Dev-Goads workspace + user JWT so the CRM's "Automated Ads Insights" tab can read this
 * workspace's ads data. Idempotent: resolves-or-creates the same user/workspace/business the
 * SSO path uses (workspace id `crm-biz-<businessId>`, business id `crm-biz-entity-<businessId>`)
 * so both entry points land on the SAME workspace and see the same campaigns/insights.
 */
export async function externalLogin(input: ExternalLoginInput): Promise<{ workspaceId: string; accessToken: string; businessId: string }> {
  const email = input.email.toLowerCase().trim();
  const name = input.name?.trim() || email;
  const crmUserId = input.externalUserId ? String(input.externalUserId) : undefined;
  // Normalize the business identifier so this MUST land on the SAME workspace as the SSO path
  // (crmLogin, which builds `crm-biz-<businessId>` from the signed token's raw business.id).
  // The CRM's two identity sources disagree on form: the SSO token sends the bare PK (e.g. "1"),
  // while this proxy sometimes forwards an already-workspace-shaped value (e.g. "crm-biz-1") as
  // businessId — which naively re-prefixed to "crm-biz-crm-biz-1", a DIFFERENT (empty) workspace
  // than the one the campaign actually launched into. Stripping any leading `crm-biz-` collapses
  // both forms to one canonical key, so insights read the same workspace the ads launched in.
  const rawBiz = input.businessId ? String(input.businessId) : "";
  const canonicalBiz = rawBiz.replace(/^crm-biz-/, "");
  // Fall back to the email when no businessId is supplied, so a workspace is still deterministic
  // per CRM identity rather than colliding across users.
  const bizKey = canonicalBiz || `email-${email}`;
  const crmPartnerId = input.partnerId ? String(input.partnerId) : null;
  const now = new Date();

  const existingUser = await prisma.user.findFirst({
    where: { OR: [...(crmUserId ? [{ crmUserId }] : []), { email }] },
  });
  const userId = existingUser?.id ?? randomUUID();

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { name, isExternal: true, crmUserId, crmBusinessId: input.businessId ? String(input.businessId) : undefined, crmPartnerId: crmPartnerId ?? undefined },
    });
  } else {
    await prisma.user.create({
      data: { id: userId, email, name, isExternal: true, crmUserId, crmBusinessId: input.businessId ? String(input.businessId) : undefined, crmPartnerId, createdAt: now },
    });
  }

  const workspaceId = `crm-biz-${bizKey}`;
  const existingWorkspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!existingWorkspace) {
    await prisma.workspace.create({
      data: { id: workspaceId, name: input.businessName || "CRM Business", ownerId: userId, plan: "starter", createdAt: now },
    });
  }

  const existingMember = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!existingMember) {
    await prisma.workspaceMember.create({
      data: { id: randomUUID(), workspaceId, userId, role: "admin", invitedAt: now, joinedAt: now },
    });
  }

  const businessId = `crm-biz-entity-${bizKey}`;
  const existingBusiness = await prisma.business.findUnique({ where: { id: businessId } });
  if (!existingBusiness) {
    let domain: string | undefined;
    try {
      domain = input.websiteUrl ? new URL(input.websiteUrl).hostname : undefined;
    } catch {
      domain = undefined;
    }
    await prisma.business.create({
      data: {
        id: businessId,
        workspaceId,
        domain,
        data: { name: input.businessName ?? "CRM Business", domain, createdAt: now.toISOString() },
        createdAt: now,
      },
    });
  }

  const accessToken = issueToken(userId, workspaceId, businessId);
  return { workspaceId, accessToken, businessId };
}

export async function crmLogin(signedToken: string): Promise<CrmAuthResult> {
  const payload = jwt.verify(signedToken, CRM_JWT_SHARED_SECRET) as CrmPayload;

  const crmUserId = String(payload.sub);
  const email = payload.email.toLowerCase().trim();
  const name = payload.name?.trim() || email;
  // Canonicalize identically to externalLogin (strip any leading crm-biz-) so the SSO path and
  // the insights external-login path ALWAYS resolve to the same `crm-biz-<id>` workspace for a
  // given CRM business — otherwise a campaign launched via SSO and the insights read via the
  // proxy land in two different workspaces and the insights tab shows an empty one.
  const crmBusinessId = String(payload.businessId).replace(/^crm-biz-/, "");
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
    // The CRM token carries the ad-account id but not its billing currency. Hardcoding "USD" here
    // mis-converts budgets on non-USD accounts (Meta's minor units + minimum-budget floor are
    // currency-specific), so an INR account silently fails to publish. Fetch the real currency from
    // Meta; fall back to USD only if the lookup fails so login never blocks on it.
    const currency =
      (await fetchAdAccountCurrency(payload.metaIntegration.accessToken, payload.metaIntegration.adAccountId)) ?? "USD";
    await setMetaOAuthConnection(workspaceId, {
      accessToken: payload.metaIntegration.accessToken,
      // Prefer the CRM-reported lifetime; fall back to 60 days only when it's missing. Hardcoding
      // 60 days made the DB treat a short-lived token as valid for two months, so the first live
      // publish 401'd with no recovery path (unlike Google's refresh-on-401).
      expiresInSeconds: payload.metaIntegration.expiresInSeconds ?? 60 * 24 * 60 * 60,
      adAccountId: payload.metaIntegration.adAccountId,
      adAccountName: payload.businessName || "CRM Ad Account",
      currency,
      pageId: payload.metaIntegration.pageId,
      pageAccessToken: payload.metaIntegration.pageAccessToken,
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
