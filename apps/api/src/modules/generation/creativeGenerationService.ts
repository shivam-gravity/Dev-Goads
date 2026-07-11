import { openai, runStructured } from "../../infra/openaiClient.js";
import { randomUUID } from "node:crypto";
import { objectStorage } from "../../infra/objectStorage.js";
import { createAsset } from "../assets/assetService.js";
import { createCreative } from "../orchestrator/creativesService.js";
import { scrapeUrl } from "../onboarding/scraper.js";
import { getImageProvider } from "./imageProvider.js";
import { getVideoProvider } from "./videoProvider.js";
import {
  createGenerationJob,
  markGenerationJobDone,
  markGenerationJobFailed,
  markGenerationJobRunning,
  getGenerationJob,
  type GenerationJobInput,
  type GenerationJobResult,
} from "./generationJobService.js";
import { logger } from "../logger/logger.js";

const CREATIVE_BRIEF_TOOL = {
  name: "emit_creative_brief",
  description: "Return ad copy and an image-generation prompt for the given product/business context.",
  input_schema: {
    type: "object" as const,
    properties: {
      headline: { type: "string", description: "Attention-grabbing headline under 40 chars" },
      body: { type: "string", description: "Compelling ad body copy under 120 chars" },
      callToAction: { type: "string", description: "Short CTA text e.g. 'Shop Now', 'Learn More'" },
      imagePrompt: { type: "string", description: "A vivid, concrete prompt for an image generation model to produce a scroll-stopping ad hero image for this product. Describe subject, setting, lighting, and mood — no text/typography in the image." },
    },
    required: ["headline", "body", "callToAction", "imagePrompt"],
  },
};

interface CreativeBrief {
  headline: string;
  body: string;
  callToAction: string;
  imagePrompt: string;
}

function fallbackBrief(context: string): CreativeBrief {
  return {
    headline: "Discover what everyone's talking about",
    body: `${context.slice(0, 90)}${context.length > 90 ? "…" : ""}`,
    callToAction: "Shop Now",
    imagePrompt: `A clean, bright product photography shot for an ad: ${context}`,
  };
}

async function generateCreativeBrief(context: string, language?: string): Promise<CreativeBrief> {
  if (!openai) return fallbackBrief(context);

  const languageInstruction = language && language !== "English"
    ? ` Write the headline, body, and call to action in ${language} (the image prompt itself should stay in English, since that's what the image model expects).`
    : "";

  const result = await runStructured<CreativeBrief>({
    maxTokens: 1024,
    tool: CREATIVE_BRIEF_TOOL,
    messages: [{ role: "user", content: `Write ad copy and an image prompt for this product/business:\n${context}${languageInstruction}` }],
  });
  return result ?? fallbackBrief(context);
}

async function resolveContext(input: GenerationJobInput): Promise<string> {
  if (input.prompt?.trim()) return input.prompt.trim();
  if (input.productUrl?.trim()) {
    try {
      const site = await scrapeUrl(input.productUrl.trim());
      return `${site.title}\n${site.description}\n${site.excerpt.slice(0, 1500)}`;
    } catch (err) {
      logger.warn(`Failed to scrape ${input.productUrl} for creative generation, falling back to raw URL`, err);
      return input.productUrl.trim();
    }
  }
  throw new Error("Either productUrl or prompt is required");
}

async function uploadGenerated(workspaceId: string, buffer: Buffer, mimeType: string, ext: string): Promise<string> {
  const key = `${workspaceId}/generated/${randomUUID()}.${ext}`;
  const { url } = await objectStorage.put(key, buffer, mimeType);
  return url;
}

/** Runs one queued GenerationJob end to end: copy + image, optionally animated into video. Called from the worker. */
export async function runGenerationJob(jobId: string): Promise<void> {
  const job = await getGenerationJob(jobId);
  if (!job) throw new Error(`GenerationJob ${jobId} not found`);

  await markGenerationJobRunning(jobId);

  try {
    const context = await resolveContext(job.input);
    const brief = await generateCreativeBrief(context, job.input.language);

    const aspectRatio = job.input.aspectRatio ?? "square";
    const image = await getImageProvider().generate(brief.imagePrompt, { aspectRatio, quality: job.input.quality });
    const imageUrl = await uploadGenerated(job.workspaceId, image.buffer, image.mimeType, "png");
    const imageAsset = await createAsset(job.workspaceId, {
      name: brief.headline,
      type: "image",
      url: imageUrl,
      size: image.buffer.length,
      mimeType: image.mimeType,
      tags: ["ai-generated", `aspect:${aspectRatio}`, `lang:${job.input.language ?? "English"}`],
    });

    let videoAsset: Awaited<ReturnType<typeof createAsset>> | undefined;
    let videoUrl: string | undefined;
    if (job.input.wantVideo) {
      const video = await getVideoProvider().generateFromImage(imageUrl, brief.imagePrompt);
      videoUrl = await uploadGenerated(job.workspaceId, video.buffer, video.mimeType, "mp4");
      videoAsset = await createAsset(job.workspaceId, {
        name: `${brief.headline} (video)`,
        type: "video",
        url: videoUrl,
        size: video.buffer.length,
        mimeType: video.mimeType,
        tags: ["ai-generated"],
      });
    }

    const creative = await createCreative(job.businessId, {
      headline: brief.headline,
      body: brief.body,
      callToAction: brief.callToAction,
      format: videoAsset ? "video" : "image",
      tags: ["ai-generated"],
      imageAssetId: imageAsset.id,
      imageUrl,
      videoAssetId: videoAsset?.id,
      videoUrl,
    });

    const result: GenerationJobResult = {
      headline: brief.headline,
      body: brief.body,
      callToAction: brief.callToAction,
      creativeId: creative.id,
      imageAssetId: imageAsset.id,
      imageUrl,
      videoAssetId: videoAsset?.id,
      videoUrl,
    };

    await markGenerationJobDone(jobId, result);
  } catch (err) {
    logger.error(`Generation job ${jobId} failed`, err);
    await markGenerationJobFailed(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export { createGenerationJob };
