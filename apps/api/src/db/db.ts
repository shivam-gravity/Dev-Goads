import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "adgo.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT,
  name TEXT NOT NULL,
  avatar TEXT,
  googleId TEXT UNIQUE,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter',
  logoUrl TEXT,
  timezone TEXT DEFAULT 'UTC',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  userId TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invitedAt TEXT NOT NULL,
  joinedAt TEXT
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  workspaceId TEXT,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  businessId TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  businessId TEXT NOT NULL,
  workspaceId TEXT,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_sets (
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL,
  workspaceId TEXT,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ads (
  id TEXT PRIMARY KEY,
  adSetId TEXT NOT NULL,
  workspaceId TEXT,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  campaignId TEXT NOT NULL,
  data TEXT NOT NULL,
  date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  businessId TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creatives (
  id TEXT PRIMARY KEY,
  businessId TEXT,
  workspaceId TEXT,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  platform TEXT NOT NULL,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_audiences (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`);

// Seed default user and workspaces for demo auth bypass
try {
  const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?").get("demo-user");
  if (!userExists) {
    db.prepare("INSERT INTO users (id, email, name, createdAt) VALUES (?, ?, ?, ?)").run(
      "demo-user",
      "ssrivastava@example.com",
      "ssrivastava",
      new Date().toISOString()
    );
  }

  // Seed demo-workspace
  const ws1Exists = db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get("demo-workspace");
  if (!ws1Exists) {
    db.prepare("INSERT INTO workspaces (id, name, ownerId, plan, timezone, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(
      "demo-workspace",
      "Default Brand",
      "demo-user",
      "pro",
      "UTC",
      new Date().toISOString()
    );
    
    db.prepare("INSERT INTO workspace_members (id, workspaceId, userId, role, invitedAt, joinedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
      "member-owner-1",
      "demo-workspace",
      "demo-user",
      "owner",
      new Date().toISOString(),
      new Date().toISOString()
    );
  }

  // Seed demo
  const ws2Exists = db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get("demo");
  if (!ws2Exists) {
    db.prepare("INSERT INTO workspaces (id, name, ownerId, plan, timezone, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(
      "demo",
      "Default Brand (Demo)",
      "demo-user",
      "pro",
      "UTC",
      new Date().toISOString()
    );
    
    db.prepare("INSERT INTO workspace_members (id, workspaceId, userId, role, invitedAt, joinedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
      "member-owner-2",
      "demo",
      "demo-user",
      "owner",
      new Date().toISOString(),
      new Date().toISOString()
    );
  }
} catch (e) {
  console.error("Failed to seed database:", e);
}

