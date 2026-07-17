import "dotenv/config";
import { prisma } from "../db/prisma.js";

/**
 * Marks a single research job cache-ineligible by flipping its `status` to "invalidated" — so
 * findReusableResearch (which only serves `status:"completed"` rows) will never reuse it again.
 * Zero migration: `status` is a free-text column, so "invalidated" is a legal value. Non-
 * destructive: the `context` blob and provider_executions are preserved for forensics; only
 * eligibility changes. Idempotent: a job already "invalidated" is a reported no-op.
 *
 * Motivating case: research job 62d2fa37 (07-16 05:54 polluxa.com) was produced during a Groq/
 * Ollama provider-timeout storm — company provider timed out (context.company=null), the market
 * provider confabulated a "medical device" industry (overallConfidence 0.34) — and was then
 * re-served by two later cache hits (07-17 10:03 and 10:59). This is the targeted stopgap; the
 * quality-gate in findReusableResearch (isReusableContext) is what prevents recurrence.
 *
 * Usage: node --env-file=.env --import tsx src/scripts/invalidateResearchJob.ts <researchJobId>
 */

const TARGET_STATUS = "invalidated";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("usage: invalidateResearchJob.ts <researchJobId>");
    process.exit(2);
  }

  const before = await prisma.researchJob.findUnique({
    where: { id: jobId },
    select: { id: true, url: true, status: true, completedAt: true },
  });

  if (!before) {
    console.log(JSON.stringify({ jobId, found: false, action: "none — no such research job" }, null, 2));
    await prisma.$disconnect();
    process.exit(1);
  }

  if (before.status === TARGET_STATUS) {
    console.log(JSON.stringify({ jobId, found: true, before: before.status, after: before.status, action: "no-op — already invalidated" }, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  }

  await prisma.researchJob.update({ where: { id: jobId }, data: { status: TARGET_STATUS } });

  const after = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { status: true } });
  console.log(JSON.stringify({
    jobId,
    url: before.url,
    found: true,
    before: before.status,
    after: after?.status,
    action: "invalidated — no longer cache-eligible (findReusableResearch serves only status='completed')",
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("invalidateResearchJob crashed", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
