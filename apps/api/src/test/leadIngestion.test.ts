import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert";
import { ingestLead, listLeads, listLeadForms, seedMockLeadData, upsertLeadForm } from "../modules/leadgen/leadIngestionService.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

// leadIngestionService.js transitively imports crmWebhookService.js, which imports
// infra/queue.js — that eagerly opens every BullMQ queue's Redis connection at module
// load, regardless of whether this file's tests ever dispatch a webhook. Same "open
// handle hangs node --test" issue as metaLeadWebhook.test.ts/campaignOrchestrator.test.ts.
after(disconnectTestInfra);

test("Lead ingestion - ingestLead upserts idempotently on redelivery", async () => {
  const workspaceId = `ws_lead_test_${Date.now()}`;
  const submittedAt = new Date();

  const first = await ingestLead({
    workspaceId,
    platform: "meta",
    externalId: "leadgen-123",
    fullName: "Jane Doe",
    email: "jane@example.com",
    submittedAt,
    data: { FULL_NAME: "Jane Doe", EMAIL: "jane@example.com" },
  });

  // Simulate Meta redelivering the same webhook event.
  const second = await ingestLead({
    workspaceId,
    platform: "meta",
    externalId: "leadgen-123",
    fullName: "Jane Doe",
    email: "jane@example.com",
    submittedAt,
    data: { FULL_NAME: "Jane Doe", EMAIL: "jane@example.com" },
  });

  assert.strictEqual(first.id, second.id, "redelivery should update the same row, not create a duplicate");

  const { data, total } = await listLeads(workspaceId, { platform: "meta" });
  assert.strictEqual(total, 1);
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0].email, "jane@example.com");
});

test("Lead ingestion - upsertLeadForm links leads to their form", async () => {
  const workspaceId = `ws_lead_test_${Date.now()}`;
  const form = await upsertLeadForm({
    workspaceId,
    platform: "meta",
    externalId: "form-1",
    name: "Get a Quote",
    data: { headline: "Get your quote", fields: ["FULL_NAME", "EMAIL"] },
  });

  await ingestLead({
    workspaceId,
    platform: "meta",
    externalId: "leadgen-linked-1",
    formExternalId: "form-1",
    email: "linked@example.com",
    submittedAt: new Date(),
    data: { EMAIL: "linked@example.com" },
  });

  const { data } = await listLeads(workspaceId, { formId: form.id });
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0].formExternalId, "form-1");
});

test("Lead ingestion - seedMockLeadData is idempotent and only seeds once per platform", async () => {
  const workspaceId = `ws_lead_test_${Date.now()}`;

  await seedMockLeadData(workspaceId, "meta");
  const { total: formsAfterFirst } = await listLeadForms(workspaceId, { platform: "meta" });
  assert.ok(formsAfterFirst > 0, "should seed at least one lead form");

  await seedMockLeadData(workspaceId, "meta");
  const { total: formsAfterSecond } = await listLeadForms(workspaceId, { platform: "meta" });
  assert.strictEqual(formsAfterFirst, formsAfterSecond, "seeding twice should not duplicate forms");

  const { total: leadTotal } = await listLeads(workspaceId, { platform: "meta" });
  assert.ok(leadTotal > 0, "should seed at least one lead");
});
