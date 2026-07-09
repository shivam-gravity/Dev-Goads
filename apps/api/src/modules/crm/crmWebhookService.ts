import { prisma } from "../../db/prisma.js";
import { crmWebhookQueue } from "../../infra/queue.js";

export interface CrmWebhookConfig {
  url: string;
  secret: string | null;
}

export async function getCrmWebhookConfig(workspaceId: string): Promise<CrmWebhookConfig | null> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { crmWebhookUrl: true, crmWebhookSecret: true },
  });
  if (!ws?.crmWebhookUrl) return null;
  return { url: ws.crmWebhookUrl, secret: ws.crmWebhookSecret };
}

export async function setCrmWebhookConfig(workspaceId: string, input: { url: string; secret?: string | null }): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { crmWebhookUrl: input.url, crmWebhookSecret: input.secret ?? null },
  });
}

export async function clearCrmWebhookConfig(workspaceId: string): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { crmWebhookUrl: null, crmWebhookSecret: null },
  });
}

export interface DispatchCrmWebhookInput {
  workspaceId: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Enqueues a CRM webhook delivery — never calls out over HTTP itself (crmWebhookWorker.ts
 * does that), so a slow/broken CRM endpoint can never add latency to the caller (ingestLead,
 * etc). No-ops entirely (doesn't even enqueue) when the workspace has no crmWebhookUrl
 * configured, so every workspace's behavior is unchanged until it opts in.
 */
export async function dispatchCrmWebhook(input: DispatchCrmWebhookInput): Promise<void> {
  const config = await getCrmWebhookConfig(input.workspaceId);
  if (!config) return;
  await crmWebhookQueue.add(input.event, { workspaceId: input.workspaceId, event: input.event, payload: input.payload });
}
