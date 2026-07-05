import { test } from "node:test";
import assert from "node:assert";

process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "test-admin-token";

const { shopifyCatalogAdapter } = await import("../modules/integrations/catalogAdapters/shopifyCatalogAdapter.js");

test("Shopify Catalog Adapter - hasLiveCredentials is true once env vars are set", () => {
  assert.strictEqual(shopifyCatalogAdapter.hasLiveCredentials, true);
});

test("Shopify Catalog Adapter - fetchCatalog calls the Admin API and maps product fields", async () => {
  const original = global.fetch;
  global.fetch = (async (url: string, options: any) => {
    assert.ok(String(url).includes("test-store.myshopify.com/admin/api"));
    assert.strictEqual(options.headers["X-Shopify-Access-Token"], "test-admin-token");
    return {
      ok: true,
      json: async () => ({
        products: [
          { title: "Aurora Earbuds", product_type: "Electronics", variants: [{ price: "79.99" }], image: { src: "https://example.com/earbuds.jpg" }, handle: "aurora-earbuds" },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const items = await shopifyCatalogAdapter.fetchCatalog();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, "Aurora Earbuds");
    assert.strictEqual(items[0].priceCents, 7999);
    assert.strictEqual(items[0].url, "https://test-store.myshopify.com/products/aurora-earbuds");
  } finally {
    global.fetch = original;
  }
});

test("Shopify Catalog Adapter - fetchCatalog throws on non-ok response", async () => {
  const original = global.fetch;
  global.fetch = (async () => ({ ok: false, status: 401, text: async () => "unauthorized" })) as unknown as typeof fetch;
  try {
    await assert.rejects(() => shopifyCatalogAdapter.fetchCatalog());
  } finally {
    global.fetch = original;
  }
});
