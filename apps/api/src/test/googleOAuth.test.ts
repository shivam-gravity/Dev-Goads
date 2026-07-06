import { test } from "node:test";
import assert from "node:assert";

process.env.JWT_SECRET = "test-jwt-secret";

test("Google OAuth - startGoogleConnect mock-connects when no OAuth client/developer token is registered", async () => {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const { startGoogleConnect } = await import(`../modules/integrations/googleOAuth.js?t=${Date.now()}`);
  const result = await startGoogleConnect("workspace-1");
  assert.deepStrictEqual(result, { mockConnected: true });
});

test("Google OAuth - getGoogleAuthUrl builds a signed-state Google consent URL when credentials are set", async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token";
  const { getGoogleAuthUrl } = await import(`../modules/integrations/googleOAuth.js?t=${Date.now()}`);
  const url = getGoogleAuthUrl("workspace-1");
  assert.ok(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
  const params = new URL(url).searchParams;
  assert.strictEqual(params.get("client_id"), "test-client-id");
  assert.strictEqual(params.get("access_type"), "offline");
  assert.ok(params.get("scope")?.includes("adwords"));
  assert.ok(params.get("state"), "state param should be present");
});

test("Google OAuth - handleGoogleOAuthCallback rejects a tampered/expired state", async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token";
  const { handleGoogleOAuthCallback } = await import(`../modules/integrations/googleOAuth.js?t=${Date.now()}`);
  await assert.rejects(() => handleGoogleOAuthCallback("some-code", "not-a-valid-jwt"));
});
