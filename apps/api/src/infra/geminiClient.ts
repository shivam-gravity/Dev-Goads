import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { ChatMessage, JsonSchemaTool } from "./openaiClient.js";
import { recordTokens } from "./tokenMeter.js";

// Gated behind GEMINI_API_KEY exactly like the other two non-OpenAI clients — no key
// means every call below degrades to a clean `null`, and llmRouter.ts's fallback wrapping
// routes the task to OpenAI instead. @google/genai (not the deprecated
// @google/generative-ai, which Google retired November 30, 2025) is the current, GA SDK.
const genai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const GEMINI_DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
}

/**
 * Forces a single named function call via Gemini's toolConfig
 * (`functionCallingConfig: {mode:"ANY", allowedFunctionNames:[name]}`) — the closest
 * equivalent to OpenAI's/Claude's forced tool-choice. Same contract as the other clients'
 * runStructured: returns the parsed function args, or null if the model didn't call it (or
 * Gemini isn't configured).
 */
export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!genai) return null;

  const response = await genai.models.generateContent({
    model: opts.model ?? GEMINI_DEFAULT_MODEL,
    contents: toGeminiContents(opts.messages),
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxTokens,
      tools: [{ functionDeclarations: [{ name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema }] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [opts.tool.name] } },
    },
  });

  recordTokens({ provider: "google", model: opts.model ?? GEMINI_DEFAULT_MODEL, kind: "structured", inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 });

  const call = response.functionCalls?.[0];
  return call?.args ? (call.args as T) : null;
}

/** Plain generateContent call, no tools — returns Gemini's text, or null if empty/not configured. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  if (!genai) return null;

  const response = await genai.models.generateContent({
    model: opts.model ?? GEMINI_DEFAULT_MODEL,
    contents: toGeminiContents(opts.messages),
    config: { systemInstruction: opts.system, maxOutputTokens: opts.maxTokens },
  });
  recordTokens({ provider: "google", model: opts.model ?? GEMINI_DEFAULT_MODEL, kind: "text", inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 });

  return response.text ?? null;
}
