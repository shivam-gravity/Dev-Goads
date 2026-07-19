/**
 * Shared request/response shapes every LLM client (openRouterClient, mistralClient,
 * ollamaClient, geminiClient) builds against — extracted from openaiClient.ts (now
 * removed) so no client "owns" these types just because OpenAI happened to be first.
 */

export interface JsonSchemaTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface WebSearchCitation {
  url: string;
  title: string;
}

export interface WebSearchOutcome {
  narrative: string;
  citations: WebSearchCitation[];
  searchesUsed: number;
}
