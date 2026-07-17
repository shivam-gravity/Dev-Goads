import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";

export const OLLAMA_DEFAULT_MODEL = "llama3.2";

export function isOllamaConfigured(): boolean {
  return false;
}

export async function runStructured<T>(_opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  return null;
}

export async function runText(_opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
}): Promise<string | null> {
  return null;
}
