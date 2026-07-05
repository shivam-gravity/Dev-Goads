import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

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

// Seed demo notifications for a workspace
export async function seedDemoNotifications(workspaceId: string): Promise<void> {
  const existing = await listNotifications(workspaceId);
  if (existing.length > 0) return;

  const demos = [
    { type: "ai_recommendation" as const, title: "Budget reallocation opportunity", message: "Your Google campaign has 3× better ROAS than Meta. Consider shifting 20% budget.", severity: "info" as const, actionUrl: "/analytics" },
    { type: "campaign_alert" as const, title: "CTR dropped 18%", message: "Campaign 'Summer Sale' saw a significant CTR drop in the last 24h. Review your creative.", severity: "warning" as const, actionUrl: "/campaigns" },
    { type: "ai_recommendation" as const, title: "New audience segment detected", message: "AI identified a high-intent audience segment: 'Tech professionals 28-35' with 2.4× avg conversion rate.", severity: "success" as const, actionUrl: "/audiences" },
    { type: "billing" as const, title: "Usage at 85%", message: "You've used 85% of your monthly AI generations. Upgrade to Pro for unlimited.", severity: "warning" as const, actionUrl: "/billing" },
  ];

  for (const d of demos) {
    await createNotification(workspaceId, d);
  }
}
