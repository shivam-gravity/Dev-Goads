/**
 * One-time backfill from the legacy apps/api/data/polluxa.sqlite file into Postgres.
 * Safe to re-run: every insert is an upsert keyed on the row's original id.
 *
 * Usage: npm run db:migrate-from-sqlite --workspace apps/api
 * (requires DATABASE_URL to point at a Postgres instance with the schema
 * already applied via `prisma migrate dev`)
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db/prisma.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(__dirname, "../data/polluxa.sqlite");

function toDate(value: string | null | undefined): Date {
  return value ? new Date(value) : new Date();
}

async function main() {
  if (!fs.existsSync(sqlitePath)) {
    console.log(`No SQLite file found at ${sqlitePath} — nothing to migrate.`);
    return;
  }

  const db = new Database(sqlitePath, { readonly: true });

  const users = db.prepare("SELECT * FROM users").all() as any[];
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: { id: u.id, email: u.email, passwordHash: u.passwordHash, name: u.name, avatar: u.avatar, googleId: u.googleId, createdAt: toDate(u.createdAt) },
      update: { email: u.email, passwordHash: u.passwordHash, name: u.name, avatar: u.avatar, googleId: u.googleId },
    });
  }
  console.log(`users: ${users.length}`);

  const workspaces = db.prepare("SELECT * FROM workspaces").all() as any[];
  for (const w of workspaces) {
    await prisma.workspace.upsert({
      where: { id: w.id },
      create: { id: w.id, name: w.name, ownerId: w.ownerId, plan: w.plan, logoUrl: w.logoUrl, timezone: w.timezone, createdAt: toDate(w.createdAt) },
      update: { name: w.name, ownerId: w.ownerId, plan: w.plan, logoUrl: w.logoUrl, timezone: w.timezone },
    });
  }
  console.log(`workspaces: ${workspaces.length}`);

  const members = db.prepare("SELECT * FROM workspace_members").all() as any[];
  for (const m of members) {
    await prisma.workspaceMember.upsert({
      where: { id: m.id },
      create: { id: m.id, workspaceId: m.workspaceId, userId: m.userId, role: m.role, invitedAt: toDate(m.invitedAt), joinedAt: m.joinedAt ? toDate(m.joinedAt) : null },
      update: { role: m.role, joinedAt: m.joinedAt ? toDate(m.joinedAt) : null },
    });
  }
  console.log(`workspace_members: ${members.length}`);

  const jsonTables: Array<{ table: string; model: keyof typeof prisma; dateField?: string }> = [
    { table: "businesses", model: "business" },
    { table: "strategies", model: "strategy" },
    { table: "campaigns", model: "campaign" },
    { table: "ad_sets", model: "adSet" },
    { table: "ads", model: "ad" },
    { table: "metrics", model: "metric" },
    { table: "invoices", model: "invoice" },
    { table: "creatives", model: "creative" },
    { table: "assets", model: "asset" },
    { table: "drafts", model: "draft" },
    { table: "insights", model: "insight" },
    { table: "notifications", model: "notification" },
    { table: "saved_audiences", model: "savedAudience" },
  ];

  for (const { table, model } of jsonTables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as any[];
    for (const row of rows) {
      const data = JSON.parse(row.data);
      const base: Record<string, unknown> = { id: row.id, data };
      if ("businessId" in row) base.businessId = row.businessId;
      if ("workspaceId" in row) base.workspaceId = row.workspaceId;
      if ("campaignId" in row) base.campaignId = row.campaignId;
      if ("adSetId" in row) base.adSetId = row.adSetId;
      if ("createdAt" in row) base.createdAt = toDate(row.createdAt);
      if ("updatedAt" in row) base.updatedAt = toDate(row.updatedAt);
      if ("date" in row) base.date = row.date;

      await (prisma[model] as any).upsert({
        where: { id: row.id },
        create: base,
        update: base,
      });
    }
    console.log(`${table}: ${rows.length}`);
  }

  // integrations keeps its typed `platform` column alongside the blob
  const integrations = db.prepare("SELECT * FROM integrations").all() as any[];
  for (const i of integrations) {
    await prisma.integration.upsert({
      where: { id: i.id },
      create: { id: i.id, workspaceId: i.workspaceId, platform: i.platform, data: JSON.parse(i.data), updatedAt: toDate(i.updatedAt) },
      update: { platform: i.platform, data: JSON.parse(i.data), updatedAt: toDate(i.updatedAt) },
    });
  }
  console.log(`integrations: ${integrations.length}`);

  db.close();
  console.log("Migration complete.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
