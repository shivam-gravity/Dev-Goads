import { test } from "node:test";
import assert from "node:assert";

process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
process.env.JWT_SECRET = "test-jwt-secret";

test("Meta OAuth - startMetaConnect mock-connects when no Meta App is registered", async () => {
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
  const { startMetaConnect } = await import(`../modules/integrations/metaOAuth.js?t=${Date.now()}`);
  const result = await startMetaConnect("workspace-1");
  assert.deepStrictEqual(result, { mockConnected: true });
});

test("Meta OAuth - getMetaAuthUrl builds a signed-state Facebook dialog URL when credentials are set", async () => {
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  const { getMetaAuthUrl } = await import(`../modules/integrations/metaOAuth.js?t=${Date.now()}`);
  const url = getMetaAuthUrl("workspace-1");
  assert.ok(url.startsWith("https://www.facebook.com/v22.0/dialog/oauth?"));
  const params = new URL(url).searchParams;
  assert.strictEqual(params.get("client_id"), "test-app-id");
  assert.ok(params.get("state"), "state param should be present");
  assert.ok(params.get("scope")?.includes("ads_management"));
});

test("Meta OAuth - handleMetaOAuthCallback rejects a tampered/expired state", async () => {
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
  const { handleMetaOAuthCallback } = await import(`../modules/integrations/metaOAuth.js?t=${Date.now()}`);
  await assert.rejects(() => handleMetaOAuthCallback("some-code", "not-a-valid-jwt"));
});
