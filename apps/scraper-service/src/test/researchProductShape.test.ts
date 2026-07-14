import { test } from "node:test";
import assert from "node:assert";
import { productFromJsonLd } from "../pipeline/researchProductShape.js";

// Route-level testing of POST /research/scrape itself isn't covered here — this service has
// no HTTP-testing library, and mocking scrapeProductUrl's real Playwright call would need
// node:test's module-mocking API, which requires Node 22.3+ (this repo runs Node 20). What
// IS cleanly unit-testable without new tooling is productFromJsonLd's reshaping logic, which
// is what /research/scrape's `wantProduct` branch actually depends on.

test("productFromJsonLd - returns undefined when no Product node exists in the JSON-LD", () => {
  const result = productFromJsonLd([{ "@type": "WebPage", name: "Home" }]);
  assert.strictEqual(result, undefined);
});

test("productFromJsonLd - extracts title/description/price/availability from a flat Product node", () => {
  const jsonLd = [
    {
      "@type": "Product",
      name: "Widget Pro",
      description: "The best widget.",
      offers: { price: "29.99", priceCurrency: "USD", availability: "https://schema.org/InStock" },
    },
  ];

  const result = productFromJsonLd(jsonLd);
  assert.strictEqual(result?.title, "Widget Pro");
  assert.strictEqual(result?.description, "The best widget.");
  assert.strictEqual(result?.variants?.[0]?.price?.amount, 29.99);
  assert.strictEqual(result?.variants?.[0]?.price?.currency, "USD");
  assert.strictEqual(result?.variants?.[0]?.availability?.inStock, true);
});

test("productFromJsonLd - finds a Product node nested under @graph", () => {
  const jsonLd = [
    {
      "@graph": [
        { "@type": "WebPage", name: "Home" },
        { "@type": "Product", name: "Nested Widget", offers: [{ price: "10", priceCurrency: "EUR" }] },
      ],
    },
  ];

  const result = productFromJsonLd(jsonLd);
  assert.strictEqual(result?.title, "Nested Widget");
  assert.strictEqual(result?.variants?.[0]?.price?.amount, 10);
  assert.strictEqual(result?.variants?.[0]?.price?.currency, "EUR");
});

test("productFromJsonLd - a Product node with no offers still returns title/description, price/availability left undefined", () => {
  const jsonLd = [{ "@type": "Product", name: "No Price Widget", description: "Contact us for pricing." }];

  const result = productFromJsonLd(jsonLd);
  assert.strictEqual(result?.title, "No Price Widget");
  assert.strictEqual(result?.variants?.[0]?.price, undefined);
  assert.strictEqual(result?.variants?.[0]?.availability, undefined);
});
