import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert";
import { prisma } from "../db/prisma.js";
import { createDraft, listDrafts } from "../modules/drafts/draftsService.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

// createDraft may call the LLM for an AI recommendation when one isn't supplied — pass an explicit
// aiRecommendation in every seed below so these tests never depend on a live model.
after(disconnectTestInfra);

test("listDrafts merges draft-status Campaigns (Generator flow) with saved Draft-table rows, tagged by origin", async () => {
  const workspaceId = `ws-drafts-${Date.now()}`;
  const businessId = `biz-drafts-${Date.now()}`;
  // The workspace's business — listDrafts also matches campaigns by the workspace's businesses.
  await prisma.business.create({ data: { id: businessId, workspaceId, data: {} } });

  // 1) A real Draft-table row (the CampaignBuilder "Save as draft" flow).
  const saved = await createDraft(workspaceId, {
    name: "Saved Draft", type: "campaign", data: { dailyBudgetCents: 5000 }, aiRecommendation: "n/a",
  });

  // 2) A draft-status Campaign (the Campaign Generator flow — never written to the Draft table).
  const draftCampaignId = `camp-draft-${Date.now()}`;
  await prisma.campaign.create({
    data: { id: draftCampaignId, businessId, workspaceId, data: { name: "Generated Draft Campaign", status: "draft", dailyBudgetCents: 9000, variants: [] } },
  });

  // 3) A launched (paused) Campaign — must NOT appear (only status "draft" is surfaced here).
  const pausedCampaignId = `camp-paused-${Date.now()}`;
  await prisma.campaign.create({
    data: { id: pausedCampaignId, businessId, workspaceId, data: { name: "Launched Campaign", status: "paused", variants: [] } },
  });

  const drafts = await listDrafts(workspaceId);

  const savedRow = drafts.find((d) => d.id === saved.id);
  assert.ok(savedRow, "the saved Draft-table row should be listed");
  assert.strictEqual(savedRow!.origin, "draft", "a Draft-table row is origin 'draft'");

  const campaignRow = drafts.find((d) => d.id === `campaign:${draftCampaignId}`);
  assert.ok(campaignRow, "the draft-status Campaign should now be surfaced on /drafts");
  assert.strictEqual(campaignRow!.origin, "campaign", "a surfaced Campaign is origin 'campaign'");
  assert.strictEqual(campaignRow!.name, "Generated Draft Campaign");
  assert.strictEqual((campaignRow!.data as Record<string, unknown>).campaignId, draftCampaignId, "carries campaignId so Edit/Publish can act on the campaign");

  assert.ok(!drafts.some((d) => d.id === `campaign:${pausedCampaignId}`), "a launched/paused campaign must NOT appear on /drafts");

  // cleanup
  await prisma.draft.deleteMany({ where: { workspaceId } });
  await prisma.campaign.deleteMany({ where: { workspaceId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
});

test("listDrafts returns an empty array for a workspace with no drafts or draft campaigns", async () => {
  const workspaceId = `ws-empty-${Date.now()}`;
  const drafts = await listDrafts(workspaceId);
  assert.deepStrictEqual(drafts, []);
});
