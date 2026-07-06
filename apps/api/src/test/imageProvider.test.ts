import { test } from "node:test";
import assert from "node:assert";
import { getImageProvider, MockImageProvider } from "../modules/generation/imageProvider.js";

test("Image Provider - falls back to MockImageProvider when OPENAI_API_KEY is unset", async () => {
  delete process.env.OPENAI_API_KEY;
  const provider = getImageProvider();
  assert.ok(provider instanceof MockImageProvider);
  const image = await provider.generate("a red shoe");
  assert.ok(image.buffer.length > 0);
  assert.strictEqual(image.mimeType, "image/png");
});
