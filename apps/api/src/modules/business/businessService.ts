import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";
import type { BusinessProfile } from "../../types/index.js";

export function createBusiness(input: Omit<BusinessProfile, "id">): BusinessProfile {
  const business: BusinessProfile = { id: randomUUID(), ...input };
  db.prepare("INSERT INTO businesses (id, data, createdAt) VALUES (?, ?, ?)").run(
    business.id,
    JSON.stringify(business),
    new Date().toISOString()
  );
  return business;
}

export function getBusiness(id: string): BusinessProfile | null {
  const row = db.prepare("SELECT data FROM businesses WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function listBusinesses(): BusinessProfile[] {
  const rows = db.prepare("SELECT data FROM businesses ORDER BY createdAt DESC").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data));
}
