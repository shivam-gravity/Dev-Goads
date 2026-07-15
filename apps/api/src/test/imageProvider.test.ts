import { test } from "node:test";
import assert from "node:assert";
import { getImageProvider, MockImageProvider } from "../modules/generation/imageProvider.js";

test("Image Provider - getImageProvider always returns MockImageProvider (no image-gen backend since OpenAI's removal)", async () => {
  const provider = getImageProvider();
  assert.ok(provider instanceof MockImageProvider);
  const image = await provider.generate("a red shoe");
  assert.ok(image.buffer.length > 0);
  assert.strictEqual(image.mimeType, "image/png");
});
