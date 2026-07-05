import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";

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

function save(n: Notification) {
  db.prepare("INSERT OR REPLACE INTO notifications (id, workspaceId, data, createdAt) VALUES (?, ?, ?, ?)").run(
    n.id, n.workspaceId, JSON.stringify(n), n.createdAt
  );
}

export function createNotification(workspaceId: string, input: Omit<Notification, "id" | "workspaceId" | "read" | "createdAt">): Notification {
  const n: Notification = { id: randomUUID(), workspaceId, read: false, createdAt: new Date().toISOString(), ...input };
  save(n);
  return n;
}

export function listNotifications(workspaceId: string): Notification[] {
  const rows = db.prepare("SELECT data FROM notifications WHERE workspaceId = ? ORDER BY createdAt DESC LIMIT 50").all(workspaceId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}

export function markRead(id: string): Notification {
  const row = db.prepare("SELECT data FROM notifications WHERE id = ?").get(id) as { data: string } | undefined;
  if (!row) throw new Error("Notification not found");
  const n: Notification = { ...JSON.parse(row.data), read: true };
  save(n);
  return n;
}

export function markAllRead(workspaceId: string): void {
  const rows = db.prepare("SELECT data FROM notifications WHERE workspaceId = ? AND json_extract(data,'$.read') = 0").all(workspaceId) as { data: string }[];
  for (const row of rows) {
    const n: Notification = { ...JSON.parse(row.data), read: true };
    save(n);
  }
}

export function unreadCount(workspaceId: string): number {
  const rows = listNotifications(workspaceId);
  return rows.filter((n) => !n.read).length;
}

// Seed demo notifications for a workspace
export function seedDemoNotifications(workspaceId: string) {
  const existing = listNotifications(workspaceId);
  if (existing.length > 0) return;

  const demos = [
    { type: "ai_recommendation" as const, title: "Budget reallocation opportunity", message: "Your Google campaign has 3× better ROAS than Meta. Consider shifting 20% budget.", severity: "info" as const, actionUrl: "/analytics" },
    { type: "campaign_alert" as const, title: "CTR dropped 18%", message: "Campaign 'Summer Sale' saw a significant CTR drop in the last 24h. Review your creative.", severity: "warning" as const, actionUrl: "/campaigns" },
    { type: "ai_recommendation" as const, title: "New audience segment detected", message: "AI identified a high-intent audience segment: 'Tech professionals 28-35' with 2.4× avg conversion rate.", severity: "success" as const, actionUrl: "/audiences" },
    { type: "billing" as const, title: "Usage at 85%", message: "You've used 85% of your monthly AI generations. Upgrade to Pro for unlimited.", severity: "warning" as const, actionUrl: "/billing" },
  ];

  for (const d of demos) {
    createNotification(workspaceId, d);
  }
}
