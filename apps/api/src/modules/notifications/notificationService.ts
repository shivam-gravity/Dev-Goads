import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { emitNotification } from "../../infra/realtimeBridge.js";

export interface Notification {
  id: string;
  workspaceId: string;
  type: "campaign_alert" | "ai_recommendation" | "billing" | "team" | "system";
  title: string;
  message: string;
  read: boolean;
  severity: "info" | "warning" | "success" | "error";
  actionUrl?: string;
  createdAt: string;
}

async function save(n: Notification): Promise<void> {
  await prisma.notification.upsert({
    where: { id: n.id },
    create: { id: n.id, workspaceId: n.workspaceId, data: n as any, createdAt: new Date(n.createdAt) },
    update: { data: n as any },
  });
}

export async function createNotification(workspaceId: string, input: Omit<Notification, "id" | "workspaceId" | "read" | "createdAt">): Promise<Notification> {
  const n: Notification = { id: randomUUID(), workspaceId, read: false, createdAt: new Date().toISOString(), ...input };
  await save(n);
  // Push to connected browsers instantly via WebSocket
  void emitNotification(workspaceId, n);
  return n;
}

export async function listNotifications(workspaceId: string): Promise<Notification[]> {
  const rows = await prisma.notification.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => r.data as unknown as Notification);
}

export async function markRead(id: string): Promise<Notification> {
  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row) throw new Error("Notification not found");
  const n: Notification = { ...(row.data as unknown as Notification), read: true };
  await save(n);
  return n;
}

export async function markAllRead(workspaceId: string): Promise<void> {
  // `data` stays a JSON blob column, so the SQLite-era `json_extract` filter
  // has no Postgres equivalent here — filter unread rows in JS instead.
  const rows = await prisma.notification.findMany({ where: { workspaceId } });
  for (const row of rows) {
    const n = row.data as unknown as Notification;
    if (!n.read) await save({ ...n, read: true });
  }
}

export async function unreadCount(workspaceId: string): Promise<number> {
  const rows = await listNotifications(workspaceId);
  return rows.filter((n) => !n.read).length;
}
