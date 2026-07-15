import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, JsonSchemaTool } from "./openaiClient.js";
import { recordTokens } from "./tokenMeter.js";

// Gated behind ANTHROPIC_API_KEY exactly like openaiClient.ts's `openai` is gated behind
// OPENAI_API_KEY — no key means this stays null forever, every call below degrades to a
// clean `null` (never throws), and llmRouter.ts's fallback wrapping routes the task to
// OpenAI instead. This is what makes it safe to assign a task to "anthropic" today, with
// zero key configured: it just always falls through.
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const CLAUDE_DEFAULT_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";

/**
 * Forces a single named tool call via Anthropic's `tool_choice: {type:"tool", name}` —
 * notably the pattern infra/openaiClient.ts's own doc comment says this codebase's
 * runStructured signature was originally modeled on, before migrating to OpenAI. Same
 * contract as openaiClient.ts's runStructured: returns the parsed tool input, or null if
 * the model didn't call it (or Claude isn't configured).
 */
export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!anthropic) return null;

  const response = await anthropic.messages.create({
    model: opts.model ?? CLAUDE_DEFAULT_MODEL,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
    tools: [{ name: opts.tool.name, description: opts.tool.description, input_schema: opts.tool.input_schema as Anthropic.Tool["input_schema"] }],
    tool_choice: { type: "tool", name: opts.tool.name },
  });

  recordTokens({ provider: "anthropic", model: opts.model ?? CLAUDE_DEFAULT_MODEL, kind: "structured", inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 });

  const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  return toolUse ? (toolUse.input as T) : null;
}

/** Plain message, no tools — returns Claude's text, or null if empty/not configured. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  if (!anthropic) return null;

  const response = await anthropic.messages.create({
    model: opts.model ?? CLAUDE_DEFAULT_MODEL,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
  });

  recordTokens({ provider: "anthropic", model: opts.model ?? CLAUDE_DEFAULT_MODEL, kind: "text", inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  return textBlock?.text ?? null;
}
