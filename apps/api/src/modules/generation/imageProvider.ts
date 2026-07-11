export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

export type ImageAspectRatio = "square" | "portrait" | "landscape";
export type ImageQuality = "standard" | "high";

export interface ImageGenOptions {
  aspectRatio?: ImageAspectRatio;
  quality?: ImageQuality;
}

// gpt-image-1 only accepts these three literal sizes (plus "auto") — these are the closest
// fits to the vertical/square/horizontal ad placements Meta/Google/TikTok actually run.
const SIZE_BY_ASPECT_RATIO: Record<ImageAspectRatio, string> = {
  square: "1024x1024",
  portrait: "1024x1536",
  landscape: "1536x1024",
};

const QUALITY_PARAM: Record<ImageQuality, string> = {
  standard: "medium",
  high: "high",
};

export interface ImageGenProvider {
  readonly name: string;
  generate(prompt: string, options?: ImageGenOptions): Promise<GeneratedImage>;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/** OpenAI Images API (gpt-image-1). Plain fetch, matching how metaAdapter/googleAdapter call their APIs directly. */
export class OpenAIImageProvider implements ImageGenProvider {
  readonly name = "openai";

  async generate(prompt: string, options?: ImageGenOptions): Promise<GeneratedImage> {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: SIZE_BY_ASPECT_RATIO[options?.aspectRatio ?? "square"],
        quality: QUALITY_PARAM[options?.quality ?? "standard"],
        n: 1,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI image generation failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { data: { b64_json: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI image generation returned no image data");

    return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }
}

/** Deterministic fallback used when OPENAI_API_KEY is unset, so local dev keeps working end-to-end. */
export class MockImageProvider implements ImageGenProvider {
  readonly name = "mock";

  async generate(_prompt: string, _options?: ImageGenOptions): Promise<GeneratedImage> {
    // 1x1 transparent PNG — enough to exercise the upload/asset pipeline without a real provider.
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    return { buffer: onePixelPng, mimeType: "image/png" };
  }
}

export function getImageProvider(): ImageGenProvider {
  return OPENAI_API_KEY ? new OpenAIImageProvider() : new MockImageProvider();
}
