import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  plan: "starter" | "pro" | "agency";
  logoUrl?: string;
  timezone: string;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
  invitedAt: string;
  joinedAt?: string;
  user?: { name: string; email: string; avatar?: string };
}

function toWorkspace(row: { id: string; name: string; ownerId: string; plan: string; logoUrl: string | null; timezone: string | null; createdAt: Date }): Workspace {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    plan: row.plan as Workspace["plan"],
    logoUrl: row.logoUrl ?? undefined,
    timezone: row.timezone ?? "UTC",
    createdAt: row.createdAt.toISOString(),
  };
}

function toMember(row: { id: string; workspaceId: string; userId: string; role: string; invitedAt: Date; joinedAt: Date | null }): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role as WorkspaceMember["role"],
    invitedAt: row.invitedAt.toISOString(),
    joinedAt: row.joinedAt?.toISOString(),
  };
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const row = await prisma.workspace.findUnique({ where: { id } });
  return row ? toWorkspace(row) : null;
}

export async function listWorkspacesForUser(userId: string): Promise<Workspace[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { workspace: { createdAt: "asc" } },
  });
  return memberships.map((m) => toWorkspace(m.workspace));
}

export async function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "logoUrl" | "timezone" | "plan">>): Promise<Workspace> {
  const ws = await getWorkspace(id);
  if (!ws) throw new Error("Workspace not found");
  const updated = { ...ws, ...patch };
  const row = await prisma.workspace.update({
    where: { id },
    data: { name: updated.name, plan: updated.plan, logoUrl: updated.logoUrl ?? null, timezone: updated.timezone },
  });
  return toWorkspace(row);
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await prisma.workspaceMember.findMany({ where: { workspaceId }, orderBy: { invitedAt: "asc" } });
  const userIds = rows.map((m) => m.userId).filter((id) => !id.startsWith("pending:"));
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } } }) : [];
  const usersById = new Map(users.map((u) => [u.id, u]));
  return rows.map((m) => {
    const user = usersById.get(m.userId);
    return { ...toMember(m), user: user ? { name: user.name, email: user.email, avatar: user.avatar ?? undefined } : undefined };
  });
}

export async function inviteMember(workspaceId: string, email: string, role: WorkspaceMember["role"]): Promise<WorkspaceMember> {
  // In production, send invite email. Here we create pending record.
  const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const invitedAt = new Date();
  const member = await prisma.workspaceMember.create({
    data: {
      id: randomUUID(),
      workspaceId,
      userId: existingUser?.id ?? `pending:${email}`,
      role,
      invitedAt,
      joinedAt: existingUser ? invitedAt : null,
    },
  });
  return toMember(member);
}

export async function updateMemberRole(memberId: string, role: WorkspaceMember["role"]): Promise<WorkspaceMember> {
  const row = await prisma.workspaceMember.update({ where: { id: memberId }, data: { role } });
  return toMember(row);
}

export async function removeMember(memberId: string): Promise<void> {
  await prisma.workspaceMember.delete({ where: { id: memberId } });
}
