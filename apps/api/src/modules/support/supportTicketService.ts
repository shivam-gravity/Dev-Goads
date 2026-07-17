import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export interface SupportTicket {
  id: string;
  workspaceId: string;
  subject: string;
  message: string;
  status: "open" | "resolved";
  createdAt: string;
}

async function save(t: SupportTicket): Promise<void> {
  await prisma.supportTicket.upsert({
    where: { id: t.id },
    create: { id: t.id, workspaceId: t.workspaceId, data: t as any, createdAt: new Date(t.createdAt) },
    update: { data: t as any },
  });
}

export async function listSupportTickets(workspaceId: string): Promise<SupportTicket[]> {
  const rows = await prisma.supportTicket.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as SupportTicket);
}

export async function createSupportTicket(workspaceId: string, input: Pick<SupportTicket, "subject" | "message">): Promise<SupportTicket> {
  const t: SupportTicket = { id: randomUUID(), workspaceId, status: "open", createdAt: new Date().toISOString(), ...input };
  await save(t);
  return t;
}
