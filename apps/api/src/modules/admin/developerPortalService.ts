import { randomUUID, randomBytes } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export interface DeveloperWebhook {
  id: string;
  workspaceId: string;
  url: string;
  events: string[];
  createdAt: string;
}

function generateApiKey(): string {
  return `sk_live_${randomBytes(24).toString("hex")}`;
}

export async function listDeveloperWebhooks(workspaceId: string): Promise<DeveloperWebhook[]> {
  const rows = await prisma.developerWebhook.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as DeveloperWebhook);
}

export async function createDeveloperWebhook(workspaceId: string, input: Pick<DeveloperWebhook, "url" | "events">): Promise<DeveloperWebhook> {
  const w: DeveloperWebhook = { id: randomUUID(), workspaceId, createdAt: new Date().toISOString(), ...input };
  await prisma.developerWebhook.create({ data: { id: w.id, workspaceId, data: w as any, createdAt: new Date(w.createdAt) } });
  return w;
}

export async function deleteDeveloperWebhook(id: string): Promise<boolean> {
  const r = await prisma.developerWebhook.deleteMany({ where: { id } });
  return r.count > 0;
}

// Only the key's creation timestamp is ever returned alongside the key itself, on the two
// calls below that legitimately mint/rotate it — no endpoint re-displays an existing key.
export async function getOrCreateApiKey(workspaceId: string): Promise<{ key: string; createdAt: string }> {
  const existing = await prisma.developerApiKey.findUnique({ where: { id: workspaceId } });
  if (existing) return { key: existing.key, createdAt: existing.createdAt.toISOString() };
  const key = generateApiKey();
  const row = await prisma.developerApiKey.create({ data: { id: workspaceId, key } });
  return { key, createdAt: row.createdAt.toISOString() };
}

export async function regenerateApiKey(workspaceId: string): Promise<{ key: string; createdAt: string }> {
  const key = generateApiKey();
  const row = await prisma.developerApiKey.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, key },
    update: { key, createdAt: new Date() },
  });
  return { key, createdAt: row.createdAt.toISOString() };
}
