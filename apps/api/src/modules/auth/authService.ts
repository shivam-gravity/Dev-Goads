import { randomUUID, createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "../../db/db.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  googleId?: string;
  createdAt: string;
}

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(salt + password + "adgo-secret").digest("hex");
}

function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

function issueToken(userId: string, workspaceId?: string): string {
  return jwt.sign({ sub: userId, workspaceId }, JWT_SECRET, { expiresIn: "30d" });
}

export function getUserById(id: string): User | null {
  const row = db.prepare("SELECT id, email, name, avatar, googleId, createdAt FROM users WHERE id = ?").get(id) as User | undefined;
  return row ?? null;
}

export function getUserByEmail(email: string): (User & { passwordHash?: string }) | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  return row ?? null;
}

export interface RegisterInput { email: string; password: string; name: string; }
export interface AuthResult { user: User; token: string; workspaceId?: string; }

export function register(input: RegisterInput): AuthResult {
  const existing = getUserByEmail(input.email);
  if (existing) throw new Error("Email already in use");

  const salt = generateSalt();
  const passwordHash = `${salt}:${hashPassword(input.password, salt)}`;
  const user: User = {
    id: randomUUID(),
    email: input.email.toLowerCase().trim(),
    name: input.name.trim(),
    createdAt: new Date().toISOString(),
  };

  db.prepare("INSERT INTO users (id, email, passwordHash, name, avatar, googleId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    user.id, user.email, passwordHash, user.name, null, null, user.createdAt
  );

  // Create default workspace
  const workspaceId = randomUUID();
  db.prepare("INSERT INTO workspaces (id, name, ownerId, plan, createdAt) VALUES (?, ?, ?, ?, ?)").run(
    workspaceId, `${user.name}'s Workspace`, user.id, "starter", user.createdAt
  );
  db.prepare("INSERT INTO workspace_members (id, workspaceId, userId, role, invitedAt, joinedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
    randomUUID(), workspaceId, user.id, "owner", user.createdAt, user.createdAt
  );

  const token = issueToken(user.id, workspaceId);
  return { user, token, workspaceId };
}

export function login(email: string, password: string): AuthResult {
  const row = getUserByEmail(email) as any;
  if (!row) throw new Error("Invalid email or password");

  if (row.passwordHash) {
    const [salt, hash] = row.passwordHash.split(":");
    if (hashPassword(password, salt) !== hash) throw new Error("Invalid email or password");
  }

  const user: User = { id: row.id, email: row.email, name: row.name, avatar: row.avatar, createdAt: row.createdAt };

  // Get primary workspace
  const member = db.prepare("SELECT workspaceId FROM workspace_members WHERE userId = ? ORDER BY joinedAt ASC LIMIT 1").get(user.id) as { workspaceId: string } | undefined;
  const workspaceId = member?.workspaceId;
  const token = issueToken(user.id, workspaceId);
  return { user, token, workspaceId };
}

export function googleAuth(name: string, email: string, googleId: string): AuthResult {
  let row = db.prepare("SELECT * FROM users WHERE googleId = ? OR email = ?").get(googleId, email.toLowerCase()) as any;

  if (!row) {
    const user: User = { id: randomUUID(), email: email.toLowerCase(), name, createdAt: new Date().toISOString() };
    db.prepare("INSERT INTO users (id, email, passwordHash, name, avatar, googleId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      user.id, user.email, null, user.name, null, googleId, user.createdAt
    );
    const workspaceId = randomUUID();
    db.prepare("INSERT INTO workspaces (id, name, ownerId, plan, createdAt) VALUES (?, ?, ?, ?, ?)").run(
      workspaceId, `${user.name}'s Workspace`, user.id, "starter", user.createdAt
    );
    db.prepare("INSERT INTO workspace_members (id, workspaceId, userId, role, invitedAt, joinedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
      randomUUID(), workspaceId, user.id, "owner", user.createdAt, user.createdAt
    );
    const token = issueToken(user.id, workspaceId);
    return { user, token, workspaceId };
  }

  if (!row.googleId) {
    db.prepare("UPDATE users SET googleId = ? WHERE id = ?").run(googleId, row.id);
  }

  const user: User = { id: row.id, email: row.email, name: row.name, avatar: row.avatar, createdAt: row.createdAt };
  const member = db.prepare("SELECT workspaceId FROM workspace_members WHERE userId = ? ORDER BY joinedAt ASC LIMIT 1").get(user.id) as { workspaceId: string } | undefined;
  const token = issueToken(user.id, member?.workspaceId);
  return { user, token, workspaceId: member?.workspaceId };
}

export function verifyToken(token: string): { userId: string; workspaceId?: string } {
  const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; workspaceId?: string };
  return { userId: decoded.sub, workspaceId: decoded.workspaceId };
}
