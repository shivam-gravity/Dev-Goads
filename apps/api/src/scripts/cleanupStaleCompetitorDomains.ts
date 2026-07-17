import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { domainMismatchesName, isUntrustworthyUrl } from "./competitorDomainDetection.js";

/**
 * Bucket A, Part 2 cleanup — clears stale citation-host values the earlier
 * migrateCompetitorMemoryUrls.ts left behind. That migration only touched
 * research_memory_entries of kind "competitor-profile"; this script covers the two gaps:
 *
 *   2(a) the relational `competitors` table — never migrated. Stores a bare `domain`
 *        hostname; flagged when it shares no significant token with the competitor's name
 *        (domainMismatchesName). Cleared to null.
 *   2(b) research_memory_entries of kind "competitor" — the migration's `where` only matched
 *        "competitor-profile", so metadata.competitors[].url on these was never scrubbed.
 *        Flagged with the full-url rule (isUntrustworthyUrl). Cleared to null.
 *
 * Same safety contract as the original migration: every affected row is written to a
 * timestamped JSON backup BEFORE any UPDATE; idempotent (an already-cleared row is skipped, so
 * counts go to 0 once clean); emits a machine-readable JSON report. Clearing to null (never
 * guessing a replacement) is the honest action — homepage resolution is Bucket B.
 *
 * Flags:
 *   --dry-run   scan + write the backup file(s), but run NO updates (counts still reported).
 *   --part=a    run only 2(a); --part=b run only 2(b); default runs both.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "..", "..", "data", "migrations");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const partArg = argv.find((a) => a.startsWith("--part="))?.split("=")[1];
const RUN_A = !partArg || partArg === "a";
const RUN_B = !partArg || partArg === "b";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
function writeBackup(prefix: string, records: unknown[]): string | null {
  if (records.length === 0) return null;
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${prefix}-${stamp()}.json`);
  writeFileSync(file, JSON.stringify(records, null, 2), "utf8");
  return file;
}

interface RelationalBackup {
  id: string;
  businessId: string;
  name: string;
  originalDomain: string;
}

/** 2(a): relational competitors table. */
async function cleanupRelational() {
  const rows = await prisma.competitor.findMany({
    select: { id: true, businessId: true, name: true, domain: true },
  });
  const scanned = rows.length;
  const backups: RelationalBackup[] = [];
  let skippedNullDomain = 0;

  for (const row of rows) {
    if (!row.domain) {
      skippedNullDomain++; // already clean (correct post-fix state)
      continue;
    }
    if (domainMismatchesName(row.name, row.domain)) {
      backups.push({ id: row.id, businessId: row.businessId, name: row.name, originalDomain: row.domain });
    }
  }

  const flagged = backups.length;
  const backupFile = writeBackup("competitor-relational-domain-backup", backups);

  let cleared = 0;
  if (!DRY_RUN) {
    for (const b of backups) {
      await prisma.competitor.update({ where: { id: b.id }, data: { domain: null } });
      cleared++;
    }
  }

  return { target: "relational competitors table", scanned, flagged, cleared, skippedNullDomain, dryRun: DRY_RUN, backupFile };
}

interface MemoryBackup {
  id: string;
  sourceUrl: string;
  competitorName: string;
  originalUrl: string;
  createdAt: string;
}

/** 2(b): research_memory_entries of kind "competitor". Logs the metadata shape walked so a
 * surprise (a legacy row using a different shape) is visible rather than silently counted clean. */
async function cleanupCompetitorMemory() {
  const rows = await prisma.researchMemoryEntry.findMany({
    where: { kind: "competitor" },
    select: { id: true, sourceUrl: true, metadata: true, createdAt: true },
  });

  const scanned = rows.length;
  const backups: MemoryBackup[] = [];
  const updates: { id: string; metadata: Record<string, unknown> }[] = [];
  let skippedMalformed = 0;
  let entriesWalked = 0;
  let rowsWithCompetitorsArray = 0;
  let rowsWithUrlEntries = 0;

  for (const row of rows) {
    const metadata = row.metadata as Record<string, unknown> | null;
    if (!metadata || typeof metadata !== "object") {
      skippedMalformed++;
      continue;
    }
    const competitors = metadata.competitors;
    if (!Array.isArray(competitors)) continue; // walked shape is metadata.competitors[]; other shapes have no url to clean
    rowsWithCompetitorsArray++;

    let rowChanged = false;
    const cleanedCompetitors = competitors.map((c) => {
      if (!c || typeof c !== "object") return c;
      const entry = c as Record<string, unknown>;
      entriesWalked++;
      const url = entry.url;
      const name = entry.name;
      if (typeof url !== "string" || url.length === 0) return entry; // no url — nothing to clean
      rowsWithUrlEntries++;
      const flaggable = typeof name !== "string" || isUntrustworthyUrl(name, url);
      if (!flaggable) return entry;
      backups.push({
        id: row.id,
        sourceUrl: row.sourceUrl,
        competitorName: typeof name === "string" ? name : "(missing name)",
        originalUrl: url,
        createdAt: row.createdAt.toISOString(),
      });
      rowChanged = true;
      return { ...entry, url: null };
    });

    if (rowChanged) updates.push({ id: row.id, metadata: { ...metadata, competitors: cleanedCompetitors } });
  }

  const flagged = backups.length;
  const backupFile = writeBackup("competitor-memory-kind-url-backup", backups);

  let nulled = 0;
  if (!DRY_RUN) {
    for (const u of updates) {
      await prisma.researchMemoryEntry.update({ where: { id: u.id }, data: { metadata: u.metadata as any } });
      nulled++;
    }
  }

  return {
    target: 'research_memory_entries kind="competitor"',
    scanned,
    flagged,
    nulled,
    dryRun: DRY_RUN,
    backupFile,
    shapeWalked: { rowsWithCompetitorsArray, entriesWalked, rowsWithUrlEntries, skippedMalformed },
  };
}

async function main() {
  const report: Record<string, unknown> = { mode: DRY_RUN ? "dry-run (no updates)" : "live", parts: partArg ?? "a+b" };
  if (RUN_A) report.partA = await cleanupRelational();
  if (RUN_B) report.partB = await cleanupCompetitorMemory();

  // eslint-disable-next-line no-console
  console.log("\n===CLEANUP_REPORT_JSON_START===");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log("===CLEANUP_REPORT_JSON_END===");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("cleanupStaleCompetitorDomains crashed", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
