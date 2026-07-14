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

  // A default Business (BusinessProfile) so the app never has to show the onboarding
  // wizard just to reach the dashboard — apps/web's AuthContext defaults businessId to
  // this id the same way it defaults workspaceId to "demo-workspace".
  await prisma.business.upsert({
    where: { id: "demo-business" },
    create: {
      id: "demo-business",
      workspaceId: "demo-workspace",
      createdAt: now,
      data: {
        id: "demo-business",
        name: "Polluxa Demo Business",
        industry: "General",
        monthlyBudgetCents: 100000,
        goals: ["Leads"],
      },
    },
    update: {},
  });

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
