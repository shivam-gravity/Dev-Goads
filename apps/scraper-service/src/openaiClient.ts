import OpenAI from "openai";

export const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;

const DEFAULT_MODEL = "gpt-4o";

export interface JsonSchemaTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Forces a single named tool call and returns its parsed arguments, or null if the model
 * didn't call it — the OpenAI function-calling equivalent of Anthropic's
 * `tool_choice: { type: "tool", name }` pattern this codebase was originally built around.
 */
export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  messages: { role: "user" | "assistant"; content: string }[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!openai) throw new Error("OPENAI_API_KEY is not set");

  const completion = await openai.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens,
    messages: opts.messages,
    tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema } }],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
  });

  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return null;
  return JSON.parse(call.function.arguments) as T;
}
