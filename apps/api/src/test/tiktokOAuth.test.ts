import { test } from "node:test";
import assert from "node:assert";

process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
process.env.JWT_SECRET = "test-jwt-secret";

test("TikTok OAuth - startTikTokConnect mock-connects when no TikTok app is registered", async () => {
  delete process.env.TIKTOK_APP_ID;
  delete process.env.TIKTOK_APP_SECRET;
  const { startTikTokConnect } = await import(`../modules/integrations/tiktokOAuth.js?t=${Date.now()}`);
  const result = await startTikTokConnect("workspace-1");
  assert.deepStrictEqual(result, { mockConnected: true });
});

test("TikTok OAuth - getTikTokAuthUrl builds a signed-state Business API authorization URL when credentials are set", async () => {
  process.env.TIKTOK_APP_ID = "test-app-id";
  process.env.TIKTOK_APP_SECRET = "test-app-secret";
  const { getTikTokAuthUrl } = await import(`../modules/integrations/tiktokOAuth.js?t=${Date.now()}`);
  const url = getTikTokAuthUrl("workspace-1");
  assert.ok(url.startsWith("https://business-api.tiktok.com/portal/auth?"));
  const params = new URL(url).searchParams;
  assert.strictEqual(params.get("app_id"), "test-app-id");
  assert.ok(params.get("state"), "state param should be present");
});

test("TikTok OAuth - handleTikTokOAuthCallback rejects a tampered/expired state", async () => {
  process.env.TIKTOK_APP_ID = "test-app-id";
  process.env.TIKTOK_APP_SECRET = "test-app-secret";
  const { handleTikTokOAuthCallback } = await import(`../modules/integrations/tiktokOAuth.js?t=${Date.now()}`);
  await assert.rejects(() => handleTikTokOAuthCallback("some-auth-code", "not-a-valid-jwt"));
});

test("TikTok OAuth - listAdvertisers returns an empty list when the workspace has no real connection (no mock accounts)", async () => {
  delete process.env.TIKTOK_APP_ID;
  delete process.env.TIKTOK_APP_SECRET;
  const { listAdvertisers } = await import(`../modules/integrations/tiktokOAuth.js?t=${Date.now()}`);
  const advertisers = await listAdvertisers(`workspace-no-connection-${Date.now()}`);
  // No fabricated "(mock)" advertisers — an unconnected workspace sees nothing to select and is
  // prompted to connect a real TikTok account instead.
  assert.strictEqual(advertisers.length, 0);
});
