import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";
import { getUserById } from "../auth/authService.js";

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

export function getWorkspace(id: string): Workspace | null {
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Workspace | undefined;
  return row ?? null;
}

export function listWorkspacesForUser(userId: string): Workspace[] {
  const rows = db.prepare(`
    SELECT w.* FROM workspaces w
    JOIN workspace_members wm ON wm.workspaceId = w.id
    WHERE wm.userId = ?
    ORDER BY w.createdAt ASC
  `).all(userId) as Workspace[];
  return rows;
}

export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "logoUrl" | "timezone" | "plan">>): Workspace {
  const ws = getWorkspace(id);
  if (!ws) throw new Error("Workspace not found");
  const updated = { ...ws, ...patch };
  db.prepare("UPDATE workspaces SET name = ?, plan = ?, logoUrl = ?, timezone = ? WHERE id = ?").run(
    updated.name, updated.plan, updated.logoUrl ?? null, updated.timezone, id
  );
  return updated;
}

export function listMembers(workspaceId: string): WorkspaceMember[] {
  const rows = db.prepare("SELECT * FROM workspace_members WHERE workspaceId = ? ORDER BY invitedAt ASC").all(workspaceId) as WorkspaceMember[];
  return rows.map((m) => {
    const user = getUserById(m.userId);
    return { ...m, user: user ? { name: user.name, email: user.email, avatar: user.avatar } : undefined };
  });
}

export function inviteMember(workspaceId: string, email: string, role: WorkspaceMember["role"]): WorkspaceMember {
  // In production, send invite email. Here we create pending record.
  const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase()) as { id: string } | undefined;
  const member: WorkspaceMember = {
    id: randomUUID(),
    workspaceId,
    userId: existingUser?.id ?? `pending:${email}`,
    role,
    invitedAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO workspace_members (id, workspaceId, userId, role, invitedAt, joinedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
    member.id, member.workspaceId, member.userId, member.role, member.invitedAt, existingUser ? member.invitedAt : null
  );
  return member;
}

export function updateMemberRole(memberId: string, role: WorkspaceMember["role"]): WorkspaceMember {
  db.prepare("UPDATE workspace_members SET role = ? WHERE id = ?").run(role, memberId);
  return db.prepare("SELECT * FROM workspace_members WHERE id = ?").get(memberId) as WorkspaceMember;
}

export function removeMember(memberId: string): void {
  db.prepare("DELETE FROM workspace_members WHERE id = ?").run(memberId);
}
