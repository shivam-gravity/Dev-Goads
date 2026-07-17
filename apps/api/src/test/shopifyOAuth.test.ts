import { test } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";

process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
process.env.JWT_SECRET = "test-jwt-secret";

test("Shopify OAuth - getShopifyInstallUrl builds the per-shop authorize URL with the merchant's own domain", async () => {
  process.env.SHOPIFY_APP_CLIENT_ID = "test-client-id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "test-client-secret";
  const { getShopifyInstallUrl } = await import(`../modules/integrations/shopifyOAuth.js?t=${Date.now()}`);

  const url = getShopifyInstallUrl("my-test-store", "signed-state-value");
  assert.ok(url.startsWith("https://my-test-store.myshopify.com/admin/oauth/authorize?"));
  const params = new URL(url).searchParams;
  assert.strictEqual(params.get("client_id"), "test-client-id");
  assert.strictEqual(params.get("state"), "signed-state-value");
  assert.ok(params.get("scope")?.includes("read_products"));
});

test("Shopify OAuth - getShopifyInstallUrl normalizes a shop domain that already includes .myshopify.com", async () => {
  process.env.SHOPIFY_APP_CLIENT_ID = "test-client-id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "test-client-secret";
  const { getShopifyInstallUrl } = await import(`../modules/integrations/shopifyOAuth.js?t=${Date.now()}`);

  const url = getShopifyInstallUrl("already-full.myshopify.com", "state");
  assert.ok(url.startsWith("https://already-full.myshopify.com/admin/oauth/authorize?"));
  assert.ok(!url.includes("already-full.myshopify.com.myshopify.com"));
});

test("Shopify OAuth - handleShopifyOAuthCallback throws (no mock fallback) when the app isn't configured", async () => {
  delete process.env.SHOPIFY_APP_CLIENT_ID;
  delete process.env.SHOPIFY_APP_CLIENT_SECRET;
  const { handleShopifyOAuthCallback } = await import(`../modules/integrations/shopifyOAuth.js?t=${Date.now()}`);
  await assert.rejects(
    () => handleShopifyOAuthCallback("workspace-1", "some-store", "some-code"),
    /not configured/,
    "unlike Meta/Google/TikTok, an unconfigured Shopify app should error, not silently mock-connect — there's no single dialog to fall back to without a specific shop"
  );
});

test("Shopify OAuth - isValidCallbackHmac accepts a correctly-signed query string and rejects a tampered one", async () => {
  process.env.SHOPIFY_APP_CLIENT_SECRET = "test-client-secret";
  const { isValidCallbackHmac } = await import(`../modules/integrations/shopifyOAuth.js?t=${Date.now()}`);

  const query: Record<string, string> = { code: "abc123", shop: "my-test-store.myshopify.com", state: "xyz", timestamp: "1700000000" };
  const message = Object.keys(query).sort().map((k) => `${k}=${query[k]}`).join("&");
  const hmac = createHmac("sha256", "test-client-secret").update(message).digest("hex");

  assert.strictEqual(isValidCallbackHmac({ ...query, hmac }), true);
  assert.strictEqual(isValidCallbackHmac({ ...query, hmac: hmac.slice(0, -2) + "00" }), false, "a tampered hmac must be rejected");
  assert.strictEqual(isValidCallbackHmac({ ...query, code: "tampered-code", hmac }), false, "a tampered query param must be rejected even with the original hmac");
});

test("Shopify OAuth - isValidCallbackHmac rejects when the app secret isn't configured (never silently accepts)", async () => {
  delete process.env.SHOPIFY_APP_CLIENT_SECRET;
  const { isValidCallbackHmac } = await import(`../modules/integrations/shopifyOAuth.js?t=${Date.now()}`);
  assert.strictEqual(isValidCallbackHmac({ code: "abc", hmac: "anything" }), false);
});
