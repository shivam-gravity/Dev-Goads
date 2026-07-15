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

export interface ImageGenProvider {
  readonly name: string;
  generate(prompt: string, options?: ImageGenOptions): Promise<GeneratedImage>;
}

/**
 * OpenAI's gpt-image-1 was the only real image-generation backend this platform ever had
 * (removed along with the rest of OpenAI — see infra/llmClient.ts's doc comment). Neither
 * Groq nor Mistral offer image generation, so MockImageProvider below is now the only
 * ImageGenProvider — a real replacement would mean adding a dedicated image-gen API
 * (Google Imagen, Stability, etc.), which is out of scope here.
 */
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
  return new MockImageProvider();
}
