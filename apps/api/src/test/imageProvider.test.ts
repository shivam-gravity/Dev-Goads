import { test } from "node:test";
import assert from "node:assert";
import { getImageProvider, DefaultImageProvider, MockImageProvider, PlaceholderImageProvider } from "../modules/generation/imageProvider.js";

// This file's assumptions depend on no keyed image API being enabled by ambient env leaked from an
// earlier test file in the same combined `npm test` process.
delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.STABILITY_API_KEY;
delete process.env.IMAGE_GENERATION_ENABLED;

test("Image Provider - getImageProvider is gated: instant mock by default, real chain only via the flag or a DEDICATED key", () => {
  delete process.env.IMAGE_GENERATION_ENABLED;
  assert.ok(getImageProvider() instanceof MockImageProvider, "no flag + no keys -> instant mock (no live pollinations.ai dependency by default)");

  // The shared GEMINI_API_KEY (also the Gemini LLM fallback key) must NOT enable image generation.
  process.env.GEMINI_API_KEY = "g-test";
  try {
    assert.ok(getImageProvider() instanceof MockImageProvider, "GEMINI_API_KEY alone (shared LLM key) must NOT enable image generation");
    // ...but once enabled by the flag, Google Imagen IS still usable as a provider.
    process.env.IMAGE_GENERATION_ENABLED = "true";
    assert.ok(getImageProvider() instanceof DefaultImageProvider, "the flag enables the chain even though only the shared key is present");
    assert.ok(new DefaultImageProvider().configuredProviders().includes("google-imagen"), "Imagen stays usable as a provider once enabled");
    delete process.env.IMAGE_GENERATION_ENABLED;
  } finally {
    delete process.env.GEMINI_API_KEY;
  }

  process.env.IMAGE_GENERATION_ENABLED = "true";
  try {
    assert.ok(getImageProvider() instanceof DefaultImageProvider, "IMAGE_GENERATION_ENABLED=true -> real multi-provider chain");
  } finally {
    delete process.env.IMAGE_GENERATION_ENABLED;
  }

  process.env.STABILITY_API_KEY = "st-test";
  try {
    assert.ok(getImageProvider() instanceof DefaultImageProvider, "a DEDICATED image API key (STABILITY) -> real chain, no flag needed");
  } finally {
    delete process.env.STABILITY_API_KEY;
  }
});

test("Image Provider - configuredProviders reflects which API keys are set, in priority order", () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.STABILITY_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test";
  try {
    assert.deepStrictEqual(new DefaultImageProvider().configuredProviders(), ["openai-gpt-image-1"]);
    process.env.GEMINI_API_KEY = "g-test";
    process.env.STABILITY_API_KEY = "st-test";
    assert.deepStrictEqual(new DefaultImageProvider().configuredProviders(), ["google-imagen", "openai-gpt-image-1", "stability"]);
  } finally {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.STABILITY_API_KEY;
  }
});

test("Image Provider - PlaceholderImageProvider always returns a visible, prompt-labeled SVG (never empty/1x1)", async () => {
  const image = await new PlaceholderImageProvider().generate("a red running shoe on a track");
  assert.ok(image.buffer.length > 0);
  assert.strictEqual(image.mimeType, "image/svg+xml");
  assert.match(image.buffer.toString("utf8"), /a red running shoe on a track/);
});

test("Image Provider - when enabled with no API keys, the chain falls through to keyless Pollinations for a real image", async () => {
  process.env.IMAGE_GENERATION_ENABLED = "true"; // opt into the chain; keys stay unset to exercise the keyless tier
  const original = global.fetch;
  let calledUrl = "";
  global.fetch = (async (url: unknown) => {
    calledUrl = String(url);
    return new Response(Buffer.from([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch;
  try {
    const image = await getImageProvider().generate("a red shoe");
    assert.match(calledUrl, /pollinations\.ai/, "with no keys, Pollinations is used");
    assert.strictEqual(image.mimeType, "image/jpeg");
    assert.ok(image.buffer.length > 0);
  } finally {
    global.fetch = original;
    delete process.env.IMAGE_GENERATION_ENABLED;
  }
});

test("Image Provider - a configured keyed API (OpenAI) takes priority over Pollinations", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const original = global.fetch;
  let calledUrl = "";
  global.fetch = (async (url: unknown) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from([9, 9, 9]).toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const image = await getImageProvider().generate("a red shoe");
    assert.match(calledUrl, /api\.openai\.com/, "the configured keyed provider is tried before Pollinations");
    assert.strictEqual(image.mimeType, "image/png");
    assert.ok(image.buffer.length > 0);
  } finally {
    global.fetch = original;
    delete process.env.OPENAI_API_KEY;
  }
});

test("Image Provider - when enabled, falls back to the placeholder SVG when every real provider fails (never a missing image)", async () => {
  process.env.IMAGE_GENERATION_ENABLED = "true";
  const original = global.fetch;
  global.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  try {
    const image = await getImageProvider().generate("a red shoe");
    assert.strictEqual(image.mimeType, "image/svg+xml", "falls back to the always-succeeds placeholder");
    assert.ok(image.buffer.length > 0);
  } finally {
    global.fetch = original;
    delete process.env.IMAGE_GENERATION_ENABLED;
  }
});
