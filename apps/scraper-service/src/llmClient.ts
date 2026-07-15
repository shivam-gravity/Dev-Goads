import OpenAI from "openai";
import { assertGlobalLlmUsageAvailable, recordGlobalLlmUsage } from "./llmUsageBoundary.js";

// OpenAI and Anthropic/Claude have been removed from this platform entirely (mirrors
// apps/api's infra/llmClient.ts — same rationale). Groq's API is OpenAI-compatible, so the
// OpenAI SDK works unchanged pointed at Groq's baseURL.
export const llm = process.env.GROQ_API_KEY ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" }) : null;

const DEFAULT_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

export interface JsonSchemaTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Forces a single named tool call and returns its parsed arguments, or null if the model
 * didn't call it. */
export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  messages: { role: "user" | "assistant"; content: string }[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!llm) throw new Error("GROQ_API_KEY is not set");
  assertGlobalLlmUsageAvailable();

  const model = opts.model ?? DEFAULT_MODEL;
  const completion = await llm.chat.completions.create({
    model,
    max_tokens: opts.maxTokens,
    messages: opts.messages,
    tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema } }],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
  });
  recordGlobalLlmUsage((completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0));

  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return null;
  return JSON.parse(call.function.arguments) as T;
}
