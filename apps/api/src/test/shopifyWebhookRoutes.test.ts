import { test, after } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

process.env.SHOPIFY_APP_CLIENT_SECRET = "test-webhook-secret";

const { isValidShopifyWebhookSignature } = await import(`../gateway/shopifyWebhookRoutes.js?t=${Date.now()}`);
after(disconnectTestInfra);

function fakeRequest(body: string, signature?: string): any {
  return {
    rawBody: Buffer.from(body, "utf8"),
    header: (name: string) => (name.toLowerCase() === "x-shopify-hmac-sha256" ? signature : undefined),
  };
}

test("Shopify webhook - accepts a correctly signed payload (base64, over the raw body)", () => {
  const body = JSON.stringify({ shop_domain: "my-test-store.myshopify.com" });
  const signature = createHmac("sha256", "test-webhook-secret").update(body).digest("base64");
  assert.strictEqual(isValidShopifyWebhookSignature(fakeRequest(body, signature)), true);
});

test("Shopify webhook - rejects a forged/unsigned payload", () => {
  const body = JSON.stringify({ shop_domain: "my-test-store.myshopify.com" });
  assert.strictEqual(isValidShopifyWebhookSignature(fakeRequest(body, "not-a-real-signature")), false);
  assert.strictEqual(isValidShopifyWebhookSignature(fakeRequest(body, undefined)), false);
});

test("Shopify webhook - rejects a tampered body even with a validly-formatted signature from elsewhere", () => {
  const originalBody = JSON.stringify({ shop_domain: "my-test-store.myshopify.com" });
  const tamperedBody = JSON.stringify({ shop_domain: "someone-elses-store.myshopify.com" });
  const signatureForOriginal = createHmac("sha256", "test-webhook-secret").update(originalBody).digest("base64");
  assert.strictEqual(isValidShopifyWebhookSignature(fakeRequest(tamperedBody, signatureForOriginal)), false);
});

test("Shopify webhook - secret rotation: a payload signed with the old secret is rejected once the app's secret rotates", async () => {
  const body = JSON.stringify({ shop_domain: "my-test-store.myshopify.com" });
  const oldSecretSignature = createHmac("sha256", "test-webhook-secret").update(body).digest("base64");
  assert.strictEqual(isValidShopifyWebhookSignature(fakeRequest(body, oldSecretSignature)), true, "sanity check: valid under the current secret");

  process.env.SHOPIFY_APP_CLIENT_SECRET = "rotated-webhook-secret";
  const { isValidShopifyWebhookSignature: isValidAfterRotation } = await import(`../gateway/shopifyWebhookRoutes.js?t=${Date.now()}`);

  assert.strictEqual(isValidAfterRotation(fakeRequest(body, oldSecretSignature)), false, "a signature made with the pre-rotation secret must not validate against the new one");

  const newSecretSignature = createHmac("sha256", "rotated-webhook-secret").update(body).digest("base64");
  assert.strictEqual(isValidAfterRotation(fakeRequest(body, newSecretSignature)), true, "a signature made with the post-rotation secret must validate");

  process.env.SHOPIFY_APP_CLIENT_SECRET = "test-webhook-secret";
});

test("Shopify webhook - rejects when SHOPIFY_APP_CLIENT_SECRET is unset", async () => {
  delete process.env.SHOPIFY_APP_CLIENT_SECRET;
  const { isValidShopifyWebhookSignature: isValidNoSecret } = await import(`../gateway/shopifyWebhookRoutes.js?t=${Date.now()}`);
  const body = JSON.stringify({ shop_domain: "my-test-store.myshopify.com" });
  const signature = createHmac("sha256", "test-webhook-secret").update(body).digest("base64");
  assert.strictEqual(isValidNoSecret(fakeRequest(body, signature)), false);
  process.env.SHOPIFY_APP_CLIENT_SECRET = "test-webhook-secret";
});
