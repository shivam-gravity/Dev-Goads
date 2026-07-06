/**
 * Seeds the demo user/workspaces used for the demo auth bypass — replaces the
 * seed block that used to run on every import of src/db/db.ts. Idempotent.
 */
import "dotenv/config";
import { prisma } from "../src/db/prisma.js";

async function main() {
  const now = new Date();

  await prisma.user.upsert({
    where: { id: "demo-user" },
    create: { id: "demo-user", email: "ssrivastava@example.com", name: "ssrivastava", createdAt: now },
    update: {},
  });

  for (const [id, name] of [
    ["demo-workspace", "Default Brand"],
    ["demo", "Default Brand (Demo)"],
  ] as const) {
    await prisma.workspace.upsert({
      where: { id },
      create: { id, name, ownerId: "demo-user", plan: "pro", timezone: "UTC", createdAt: now },
      update: {},
    });

    const existingMember = await prisma.workspaceMember.findFirst({ where: { workspaceId: id, userId: "demo-user" } });
    if (!existingMember) {
      await prisma.workspaceMember.create({
        data: { id: `member-owner-${id}`, workspaceId: id, userId: "demo-user", role: "owner", invitedAt: now, joinedAt: now },
      });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
