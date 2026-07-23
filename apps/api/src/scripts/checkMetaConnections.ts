/**
 * Secret-safe Meta connection health check.
 *
 * Lists every workspace with a Meta Integration row and reports whether its stored
 * (encrypted) token is still valid, by round-tripping the real Graph API. It prints
 * ONLY non-sensitive health data — workspace id, ad-account name/status/currency,
 * page name, token expiry date, granted scopes — and NEVER any part of the access
 * token itself. Use it to decide whether a live publish/test is possible.
 *
 *   npx tsx src/scripts/checkMetaConnections.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getMetaCredentials } from "../modules/integrations/integrationService.js";

const GRAPH = "https://graph.facebook.com/v22.0";
const prisma = new PrismaClient();

async function gget(path: string, token: string): Promise<any> {
  const url = `${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  return res.json();
}

async function main() {
  const rows = await prisma.integration.findMany({ where: { platform: "meta" } });
  console.log(`Found ${rows.length} Meta integration row(s).\n`);

  for (const row of rows) {
    const ws = row.workspaceId;
    // Resolve through the SAME code path the publisher uses (status gate + decrypt).
    const creds = await getMetaCredentials(ws).catch((e) => {
      console.log(`• ${ws}: getMetaCredentials threw — ${e.message}`);
      return null;
    });
    if (!creds) {
      console.log(`• ${ws}: NOT connected (status!=connected or missing token/account)`);
      continue;
    }

    const token = creds.accessToken;
    const me = await gget("/me?fields=id,name", token).catch((e) => ({ error: { message: e.message } }));
    if (me.error) {
      console.log(`• ${ws}: TOKEN INVALID — ${me.error.code}/${me.error.error_subcode ?? "-"} ${me.error.message}`);
      continue;
    }

    const acctId = String(creds.adAccountId).replace(/^act_/, "");
    const acct = await gget(`/act_${acctId}?fields=name,account_status,currency,disable_reason`, token).catch((e) => ({ error: { message: e.message } }));
    const dbg = await gget(`/debug_token?input_token=${encodeURIComponent(token)}`, token).catch(() => ({}));
    const d = dbg?.data ?? {};
    const expiresAt = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "unknown";
    const scopes: string[] = d.scopes ?? [];
    const page = creds.pageId
      ? await gget(`/${creds.pageId}?fields=name`, creds.pageAccessToken ?? token).catch(() => ({ error: { message: "fetch failed" } }))
      : null;

    const acctLine = acct.error
      ? `acct ERROR ${acct.error.code}`
      : `acct "${acct.name}" status=${acct.account_status} ${acct.currency}${acct.disable_reason ? ` disable_reason=${acct.disable_reason}` : ""}`;
    const pageLine = !creds.pageId ? "NO PAGE" : page?.error ? `page ERROR (${page.error.message})` : `page "${page.name}"`;
    const hasAdsScope = scopes.includes("ads_management") || scopes.includes("ads_read");

    console.log(
      `• ${ws}: VALID (${me.name}) | ${acctLine} | ${pageLine} | expires ${expiresAt} | ads_management=${scopes.includes("ads_management")} | scopes ${hasAdsScope ? "ok" : "MISSING ads scope"}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
