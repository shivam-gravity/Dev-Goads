export interface GeneratedVideo {
  buffer: Buffer;
  mimeType: string;
}

export interface VideoGenProvider {
  readonly name: string;
  /** Animates a still image into a short ad video. Polls internally until the provider job finishes. */
  generateFromImage(imageUrl: string, prompt: string): Promise<GeneratedVideo>;
}

const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;
const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 45; // ~3 minutes

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runway's image-to-video API: animates the AI-generated hero image into a short
 * clip rather than generating video from text alone — cheaper and keeps the video
 * on-brand with whatever image the user already approved.
 */
export class RunwayVideoProvider implements VideoGenProvider {
  readonly name = "runway";

  async generateFromImage(imageUrl: string, prompt: string): Promise<GeneratedVideo> {
    if (!RUNWAY_API_KEY) throw new Error("RUNWAY_API_KEY is not set");

    const createRes = await fetch(`${RUNWAY_API_BASE}/image_to_video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNWAY_API_KEY}`,
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        model: "gen4_turbo",
        promptImage: imageUrl,
        promptText: prompt,
        ratio: "1280:720",
        duration: 5,
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Runway video generation failed to start (${createRes.status}): ${await createRes.text()}`);
    }

    const { id: taskId } = (await createRes.json()) as { id: string };

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const statusRes = await fetch(`${RUNWAY_API_BASE}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${RUNWAY_API_KEY}`, "X-Runway-Version": "2024-11-06" },
      });
      if (!statusRes.ok) throw new Error(`Runway task status check failed (${statusRes.status})`);

      const status = (await statusRes.json()) as { status: string; output?: string[]; failure?: string };
      if (status.status === "SUCCEEDED") {
        const videoUrl = status.output?.[0];
        if (!videoUrl) throw new Error("Runway task succeeded but returned no output video URL");
        const videoRes = await fetch(videoUrl);
        if (!videoRes.ok) throw new Error(`Failed to download generated video (${videoRes.status})`);
        return { buffer: Buffer.from(await videoRes.arrayBuffer()), mimeType: "video/mp4" };
      }
      if (status.status === "FAILED") {
        throw new Error(`Runway video generation failed: ${status.failure ?? "unknown error"}`);
      }
      // PENDING / RUNNING — keep polling.
    }

    throw new Error("Runway video generation timed out");
  }
}

/** Deterministic fallback used when RUNWAY_API_KEY is unset, so local dev keeps working end-to-end. */
export class MockVideoProvider implements VideoGenProvider {
  readonly name = "mock";

  async generateFromImage(_imageUrl: string, _prompt: string): Promise<GeneratedVideo> {
    return { buffer: Buffer.from([]), mimeType: "video/mp4" };
  }
}

export function getVideoProvider(): VideoGenProvider {
  return RUNWAY_API_KEY ? new RunwayVideoProvider() : new MockVideoProvider();
}
