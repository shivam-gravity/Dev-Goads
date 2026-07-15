import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { createCampaignGenerationJob } from "../modules/orchestrator/campaignGenerationService.js";

const prior = await prisma.campaignGenerationJob.findFirst({
  where: { url: "polluxa.com" },
  orderBy: { createdAt: "desc" },
});
if (!prior) throw new Error("no prior polluxa.com job found");

const job = await createCampaignGenerationJob({
  workspaceId: prior.workspaceId,
  businessId: prior.businessId,
  url: prior.url,
  name: prior.name ?? undefined,
});
console.log(JSON.stringify({ jobId: job.id, workspaceId: job.workspaceId, businessId: job.businessId, url: job.url }, null, 2));
await prisma.$disconnect();
process.exit(0);
