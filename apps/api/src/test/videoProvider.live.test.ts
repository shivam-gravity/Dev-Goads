import { test } from "node:test";
import assert from "node:assert";

// Live-credential paths are gated by env vars read at module load time — see
// imageProvider.live.test.ts / metaAdapter.live.test.ts for why this needs its own file.
process.env.RUNWAY_API_KEY = "test-key";

const { RunwayVideoProvider } = await import("../modules/generation/videoProvider.js");

test("Video Provider (live) - RunwayVideoProvider polls until SUCCEEDED and downloads the result", async () => {
  const provider = new RunwayVideoProvider();

  const original = global.fetch;
  let pollCount = 0;
  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/image_to_video")) {
      return { ok: true, json: async () => ({ id: "task-123" }) } as Response;
    }
    if (u.includes("/tasks/task-123")) {
      pollCount++;
      if (pollCount < 2) return { ok: true, json: async () => ({ status: "RUNNING" }) } as Response;
      return { ok: true, json: async () => ({ status: "SUCCEEDED", output: ["https://cdn.example.com/video.mp4"] }) } as Response;
    }
    if (u.includes("cdn.example.com/video.mp4")) {
      return { ok: true, arrayBuffer: async () => Buffer.from("fake-video-bytes") } as unknown as Response;
    }
    throw new Error(`Unexpected fetch: ${u}`);
  }) as typeof fetch;

  try {
    const video = await provider.generateFromImage("https://example.com/hero.png", "animate this");
    assert.strictEqual(video.buffer.toString(), "fake-video-bytes");
    assert.strictEqual(video.mimeType, "video/mp4");
  } finally {
    global.fetch = original;
  }
});
