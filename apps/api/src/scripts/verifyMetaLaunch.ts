/**
 * Verifies a launched Meta campaign really exists on the Graph API and is PAUSED (no spend).
 * Prints only non-sensitive object fields (id/name/status/effective_status) — never the token.
 *
 *   npx tsx src/scripts/verifyMetaLaunch.ts <workspaceId> <campaignExternalId> <adId,adId,...>
 */
import "dotenv/config";
import { getMetaCredentials } from "../modules/integrations/integrationService.js";

const GRAPH = "https://graph.facebook.com/v22.0";

async function gget(path: string, token: string): Promise<any> {
  const res = await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
  return res.json();
}

async function main() {
  const [workspaceId, campaignId, adIdsCsv] = process.argv.slice(2);
  const creds = await getMetaCredentials(workspaceId);
  if (!creds) throw new Error(`No Meta credentials for ${workspaceId}`);
  const token = creds.accessToken;

  const campaign = await gget(`/${campaignId}?fields=id,name,status,effective_status,objective`, token);
  console.log("CAMPAIGN:", JSON.stringify(campaign));

  const adSets = await gget(`/${campaignId}/adsets?fields=id,name,status,effective_status,daily_budget`, token);
  console.log("AD SETS:", JSON.stringify((adSets.data ?? []).map((a: any) => ({ id: a.id, status: a.status, effective_status: a.effective_status, daily_budget: a.daily_budget }))));

  for (const adId of (adIdsCsv ?? "").split(",").filter(Boolean)) {
    const ad = await gget(`/${adId}?fields=id,name,status,effective_status`, token);
    console.log("AD:", JSON.stringify(ad));
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
