import { prisma } from "../../db/prisma.js";

export interface NotificationPreferences {
  emailAlerts: boolean;
  slackAlerts: boolean;
  digestAlerts: boolean;
}

const DEFAULTS: NotificationPreferences = { emailAlerts: true, slackAlerts: false, digestAlerts: true };

export async function getNotificationPreferences(workspaceId: string): Promise<NotificationPreferences> {
  const row = await prisma.notificationPreference.findUnique({ where: { id: workspaceId } });
  return row ? { ...DEFAULTS, ...(row.data as unknown as NotificationPreferences) } : DEFAULTS;
}

export async function setNotificationPreferences(workspaceId: string, prefs: NotificationPreferences): Promise<NotificationPreferences> {
  await prisma.notificationPreference.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, data: prefs as any },
    update: { data: prefs as any },
  });
  return prefs;
}
