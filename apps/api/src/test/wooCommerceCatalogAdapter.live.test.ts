import { test } from "node:test";
import assert from "node:assert";

process.env.WOOCOMMERCE_STORE_URL = "https://store.example.com";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck_test";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs_test";

const { wooCommerceCatalogAdapter } = await import("../modules/integrations/catalogAdapters/wooCommerceCatalogAdapter.js");

test("WooCommerce Catalog Adapter - hasLiveCredentials is true once env vars are set", () => {
  assert.strictEqual(wooCommerceCatalogAdapter.hasLiveCredentials, true);
});

test("WooCommerce Catalog Adapter - fetchCatalog calls the REST API with basic auth and maps product fields", async () => {
  const original = global.fetch;
  global.fetch = (async (url: string, options: any) => {
    assert.ok(String(url).includes("store.example.com/wp-json/wc/v3/products"));
    const expectedAuth = `Basic ${Buffer.from("ck_test:cs_test").toString("base64")}`;
    assert.strictEqual(options.headers.Authorization, expectedAuth);
    return {
      ok: true,
      json: async () => [
        { name: "Canvas Apron", categories: [{ name: "Home & Living" }], price: "32.00", images: [{ src: "https://example.com/apron.jpg" }], permalink: "https://store.example.com/product/canvas-apron" },
      ],
    } as Response;
  }) as typeof fetch;

  try {
    const items = await wooCommerceCatalogAdapter.fetchCatalog();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, "Canvas Apron");
    assert.strictEqual(items[0].priceCents, 3200);
    assert.strictEqual(items[0].category, "Home & Living");
  } finally {
    global.fetch = original;
  }
});

test("WooCommerce Catalog Adapter - fetchCatalog throws on non-ok response", async () => {
  const original = global.fetch;
  global.fetch = (async () => ({ ok: false, status: 403, text: async () => "forbidden" })) as unknown as typeof fetch;
  try {
    await assert.rejects(() => wooCommerceCatalogAdapter.fetchCatalog());
  } finally {
    global.fetch = original;
  }
});
