import { test } from "node:test";
import assert from "node:assert";

// Live-credential paths are gated by env vars read at module load time, so they must be
// set before the module is imported — hence the dynamic import and a dedicated test file,
// isolated from imageProvider.test.ts's mock-path run (same pattern as metaAdapter.live.test.ts).
process.env.OPENAI_API_KEY = "test-key";

const { OpenAIImageProvider } = await import("../modules/generation/imageProvider.js");

test("Image Provider (live) - OpenAIImageProvider calls the images API and decodes the result", async () => {
  const provider = new OpenAIImageProvider();

  const original = global.fetch;
  global.fetch = (async (url: string, options: RequestInit) => {
    assert.ok(String(url).includes("api.openai.com/v1/images/generations"));
    assert.ok(String((options.headers as any).Authorization).includes("test-key"));
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from("fake-image-bytes").toString("base64") }] }),
    } as Response;
  }) as typeof fetch;

  try {
    const image = await provider.generate("a red shoe");
    assert.strictEqual(image.buffer.toString(), "fake-image-bytes");
    assert.strictEqual(image.mimeType, "image/png");
  } finally {
    global.fetch = original;
  }
});
