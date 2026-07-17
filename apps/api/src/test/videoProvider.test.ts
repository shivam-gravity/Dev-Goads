import { test } from "node:test";
import assert from "node:assert";
import { getVideoProvider, MockVideoProvider } from "../modules/generation/videoProvider.js";

test("Video Provider - falls back to MockVideoProvider when RUNWAY_API_KEY is unset", async () => {
  delete process.env.RUNWAY_API_KEY;
  const provider = getVideoProvider();
  assert.ok(provider instanceof MockVideoProvider);
  const video = await provider.generateFromImage("https://example.com/hero.png", "animate this");
  assert.strictEqual(video.mimeType, "video/mp4");
});
