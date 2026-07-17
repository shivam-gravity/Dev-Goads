import { Router } from "express";
import { asyncHandler } from "./asyncHandler.js";
import type { AuthedRequest } from "./middleware/auth.js";
import { chatWithStrategistStream } from "../modules/strategist/strategistStreamService.js";
import { logger } from "../modules/logger/logger.js";

export const sseStreamRoutes = Router();

/**
 * SSE endpoint for streaming chat responses from the AI Strategist.
 * Instead of waiting for the full response, tokens are streamed as they arrive.
 *
 * Client connects via EventSource or fetch with streaming:
 * POST /api/chat/stream
 * Body: { businessId, messages: [...] }
 *
 * Response: text/event-stream with chunks:
 * data: {"chunk":"Hello","done":false}
 * data: {"chunk":" world","done":false}
 * data: {"chunk":"","done":true,"fullText":"Hello world"}
 */
sseStreamRoutes.post("/chat/stream", asyncHandler(async (req: AuthedRequest, res) => {
  const { businessId, messages } = req.body;
  if (!businessId || !Array.isArray(messages)) {
    return res.status(400).json({ error: "businessId and messages[] required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let closed = false;
  req.on("close", () => { closed = true; });

  try {
    await chatWithStrategistStream(businessId, messages, (chunk, done, fullText) => {
      if (closed) return;
      const data = JSON.stringify({ chunk, done, fullText: done ? fullText : undefined });
      res.write(`data: ${data}\n\n`);
      if (done) res.end();
    });
  } catch (err) {
    logger.error("SSE chat stream error", err);
    if (!closed) {
      res.write(`data: ${JSON.stringify({ error: "Stream failed", done: true })}\n\n`);
      res.end();
    }
  }
}));
