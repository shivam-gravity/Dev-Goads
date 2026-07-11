import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import {
  requireAdAccess,
  requireDraftAccess,
  requireStrategyAccess,
} from "../gateway/middleware/resourceOwnership.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

/** Runs a middleware with a fake req/res and reports what it did. */
async function invoke(middleware: (req: any, res: any, next: any) => Promise<any>, id: string, userId: string) {
  let statusCode: number | null = null;
  let nextCalled = false;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  };
  await middleware({ params: { id }, userId }, res, () => { nextCalled = true; });
  return { statusCode, nextCalled };
}

async function createTenant(suffix: string) {
  const workspaceId = `ws-own-${suffix}-${Date.now()}`;
  const userId = `user-own-${suffix}-${Date.now()}`;
  await prisma.workspace.create({ data: { id: workspaceId, name: `Ownership test ${suffix}`, ownerId: userId } });
  await prisma.workspaceMember.create({ data: { id: randomUUID(), workspaceId, userId, role: "owner", invitedAt: new Date(), joinedAt: new Date() } });
  return { workspaceId, userId };
}

async function deleteTenant(t: { workspaceId: string; userId: string }) {
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: t.workspaceId } });
  await prisma.workspace.delete({ where: { id: t.workspaceId } }).catch(() => {});
}

test("resourceOwnership - a direct-workspace resource (draft) is 200 for its own tenant, 403 cross-tenant, 404 when missing", async () => {
  const tenantA = await createTenant("A");
  const tenantB = await createTenant("B");
  const draftId = randomUUID();
  await prisma.draft.create({ data: { id: draftId, workspaceId: tenantA.workspaceId, data: {} } });

  try {
    const owner = await invoke(requireDraftAccess, draftId, tenantA.userId);
    assert.strictEqual(owner.nextCalled, true, "the owning tenant's member must pass through");

    const intruder = await invoke(requireDraftAccess, draftId, tenantB.userId);
    assert.strictEqual(intruder.statusCode, 403, "another tenant's member must be rejected");
    assert.strictEqual(intruder.nextCalled, false);

    const missing = await invoke(requireDraftAccess, randomUUID(), tenantA.userId);
    assert.strictEqual(missing.statusCode, 404);
  } finally {
    await prisma.draft.delete({ where: { id: draftId } }).catch(() => {});
    await deleteTenant(tenantA);
    await deleteTenant(tenantB);
  }
});

test("resourceOwnership - an ad resolves its workspace up the Ad -> AdSet -> Campaign -> Business chain", async () => {
  const tenantA = await createTenant("chainA");
  const tenantB = await createTenant("chainB");
  const businessId = randomUUID();
  const campaignId = randomUUID();
  const adSetId = randomUUID();
  const adId = randomUUID();
  await prisma.business.create({ data: { id: businessId, workspaceId: tenantA.workspaceId, data: { id: businessId, name: "Chain Co" } as any } });
  // Neither the campaign, ad set, nor ad carries a workspaceId of its own — the middleware
  // must walk the whole chain to the business to find the owner.
  await prisma.campaign.create({ data: { id: campaignId, businessId, data: {} } });
  await prisma.adSet.create({ data: { id: adSetId, campaignId, data: {} } });
  await prisma.ad.create({ data: { id: adId, adSetId, data: {} } });

  try {
    const owner = await invoke(requireAdAccess, adId, tenantA.userId);
    assert.strictEqual(owner.nextCalled, true, "owner resolved through the full chain must pass");

    const intruder = await invoke(requireAdAccess, adId, tenantB.userId);
    assert.strictEqual(intruder.statusCode, 403);
  } finally {
    await prisma.ad.delete({ where: { id: adId } }).catch(() => {});
    await prisma.adSet.delete({ where: { id: adSetId } }).catch(() => {});
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {});
    await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
    await deleteTenant(tenantA);
    await deleteTenant(tenantB);
  }
});

test("resourceOwnership - fails closed: a strategy whose business has no workspace is 403 even for a real member", async () => {
  const tenantA = await createTenant("closedA");
  const businessId = randomUUID();
  const strategyId = randomUUID();
  await prisma.business.create({ data: { id: businessId, workspaceId: null, data: { id: businessId, name: "Orphan Co" } as any } });
  await prisma.strategy.create({ data: { id: strategyId, businessId, data: {} } });

  try {
    const member = await invoke(requireStrategyAccess, strategyId, tenantA.userId);
    assert.strictEqual(member.statusCode, 403, "an ownerless resource must be inaccessible, not open to everyone");
    assert.strictEqual(member.nextCalled, false);
  } finally {
    await prisma.strategy.delete({ where: { id: strategyId } }).catch(() => {});
    await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
    await deleteTenant(tenantA);
  }
});
