import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";

/**
 * One-time cleanup for research_memory_entries rows written before discovery.ts stopped
 * letting extractNamesFromNarrative() invent a `url` for a discovered competitor (see the
 * doc comment on NAME_EXTRACTION_TOOL in research/competitor-intelligence/discovery.ts).
 * That call had no citation to check a url against, and in practice never got it right: it
 * consistently attached the url of whatever article/comparison-page the narrative came
 * from, not the named competitor's own site (audited: 76/76 flagged rows below are a
 * citation page — g2.com, forbes.com, owler.com, etc. — not the competitor's homepage).
 *
 * This only nulls the `url` field on flagged rows — every other field (positioning,
 * pricing, strengths, weaknesses, ...) comes from enrichment.ts's ENRICHMENT_TOOL, whose
 * schema has no `url` property at all, so those fields were never exposed to this bug and
 * are left untouched.
 *
 * Idempotent: a row already nulled (metadata.url is null/absent) has nothing to check a
 * hostname against, so it's skipped on every subsequent run — flaggedCount/nulledCount
 * both go to 0 once the backlog is clean, rather than erroring or re-processing.
 *
 * Safety: every flagged row's id/name/original url is written to a timestamped JSON backup
 * file BEFORE any UPDATE runs, so the original values are recoverable if a real
 * verification source (live web search again) ever comes back.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "..", "..", "data", "migrations");

// Mirrors research/competitor-intelligence/enrichment.ts's coreName/isRelevantCitation
// logic (kept as its own copy, not imported, since a migration script should stay a frozen
// snapshot of the rule it applied — see support.ts's own note on why isRelevantCitation is
// duplicated rather than shared for the same reason).
const CORPORATE_SUFFIXES = /\b(inc|incorporated|corp|corporation|holdings|ltd|llc|co|company|group)\b\.?/g;

function coreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(CORPORATE_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function isRootPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname === "" || pathname === "/";
  } catch {
    return false;
  }
}

/** Flags a url as untrustworthy if its hostname shares no meaningful token with the
 * competitor's own name, OR it isn't a bare root-domain url (a genuine homepage is
 * essentially always the latter; every audited bad row was a deep-linked article, never a
 * root path). Either signal alone is enough — a citation page can coincidentally live on
 * the right domain (see the "Airtable" case in the audit: airtable.com/articles/... is
 * still one of Airtable's own blog posts, not their homepage) but essentially never
 * satisfies both "right domain" and "root path" at once unless it's a real homepage. */
function isUntrustworthy(name: string, url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return true; // unparseable — nothing to trust
  const n = coreName(name);
  const significantWords = n.split(" ").filter((w) => w.length >= 4);
  const flatName = n.replace(/\s+/g, "");
  const hostnameMatches = significantWords.some((w) => host.includes(w)) || (flatName.length > 0 && host.includes(flatName));
  return !hostnameMatches || !isRootPath(url);
}

interface BackupRecord {
  id: string;
  sourceUrl: string;
  competitorName: string;
  originalUrl: string;
  createdAt: string;
}

async function main() {
  const rows = await prisma.researchMemoryEntry.findMany({
    where: { kind: "competitor-profile" },
    select: { id: true, sourceUrl: true, metadata: true, createdAt: true },
  });

  const scanned = rows.length;
  const backups: BackupRecord[] = [];
  const idsToNull: { id: string; metadata: Record<string, unknown> }[] = [];
  let skippedNoUrl = 0;
  let skippedMalformed = 0;

  for (const row of rows) {
    const metadata = row.metadata as Record<string, unknown> | null;
    if (!metadata || typeof metadata !== "object") {
      skippedMalformed++;
      continue;
    }
    const name = metadata.name;
    const url = metadata.url;
    if (typeof url !== "string" || url.length === 0) {
      skippedNoUrl++; // already clean (never had a url, or a prior run already nulled it)
      continue;
    }
    if (typeof name !== "string") {
      // No competitor name to check a hostname against — can't verify, so treat as
      // untrustworthy rather than silently trusting it.
      backups.push({ id: row.id, sourceUrl: row.sourceUrl, competitorName: "(missing name)", originalUrl: url, createdAt: row.createdAt.toISOString() });
      idsToNull.push({ id: row.id, metadata: { ...metadata, url: null } });
      continue;
    }
    if (isUntrustworthy(name, url)) {
      backups.push({ id: row.id, sourceUrl: row.sourceUrl, competitorName: name, originalUrl: url, createdAt: row.createdAt.toISOString() });
      idsToNull.push({ id: row.id, metadata: { ...metadata, url: null } });
    }
  }

  const flagged = backups.length;

  // Write the backup BEFORE any mutation — if the process dies mid-update below, this
  // file still fully documents every row that was going to be (or partially was) changed.
  let backupPath: string | null = null;
  if (flagged > 0) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(BACKUP_DIR, `competitor-memory-url-backup-${stamp}.json`);
    writeFileSync(backupPath, JSON.stringify(backups, null, 2), "utf8");
  }

  let nulled = 0;
  for (const { id, metadata } of idsToNull) {
    await prisma.researchMemoryEntry.update({ where: { id }, data: { metadata: metadata as any } });
    nulled++;
  }

  const report = {
    scanned,
    flagged,
    nulled,
    skippedAlreadyClean: skippedNoUrl,
    skippedMalformed,
    backupFile: backupPath,
  };
  // eslint-disable-next-line no-console
  console.log("\n===MIGRATION_REPORT_JSON_START===");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log("===MIGRATION_REPORT_JSON_END===");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("migrateCompetitorMemoryUrls crashed", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
