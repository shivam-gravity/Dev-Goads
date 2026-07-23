import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { recordTokens } from "./tokenMeter.js";
import { assertGlobalLlmUsageAvailable, recordGlobalLlmUsage } from "./llmUsageBoundary.js";
import { logger } from "../modules/logger/logger.js";

// Amazon Bedrock (Claude) via the Converse API, hit with PLAIN FETCH — no @aws-sdk dependency.
// Auth is a first-class Bedrock API key passed as a bearer
// token (AWS_BEARER_TOKEN_BEDROCK), so there is NO SigV4 request signing to do; that's the whole
// reason this can be a dependency-free fetch client rather than pulling in the AWS SDK + its
// credential-provider chain. Gated behind the token exactly like the other non-OpenAI clients:
// no token → every call returns a clean `null`, and llmRouter's fallback wrapping routes the task
// to another provider instead.
//
// Live-verified 2026-07-21 against bedrock-runtime.{region}.amazonaws.com/model/{id}/converse:
// plain text AND forced tool-use (toolChoice.tool) both return the shapes parsed below. Unlike
// the free-tier providers, Bedrock is PAID/metered and not rate-limited the same way — but it can
// still 429 (ThrottlingException) under burst, so the same concurrency-cap + retry-with-backoff
// guard the other clients use applies here too.
const BEDROCK_BEARER_TOKEN = process.env.AWS_BEARER_TOKEN_BEDROCK;
const BEDROCK_REGION = process.env.AWS_REGION ?? "us-east-1";
const BEDROCK_DEFAULT_MODEL = process.env.BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
// Amazon Titan Text Embeddings V2 — the embeddings backend for Research Memory / RAG. Titan V2
// supports 256/512/1024-dim output; 1024 keeps parity with the previous provider's dimension
// (ResearchMemoryStore expects a fixed width). Overridable via BEDROCK_EMBEDDING_MODEL.
const BEDROCK_EMBEDDING_MODEL = process.env.BEDROCK_EMBEDDING_MODEL ?? "amazon.titan-embed-text-v2:0";
const BEDROCK_EMBEDDING_DIMENSIONS = Math.max(1, Number(process.env.BEDROCK_EMBEDDING_DIMENSIONS ?? 1024));

const BEDROCK_MAX_CONCURRENCY = Math.max(1, Number(process.env.BEDROCK_MAX_CONCURRENCY ?? 4));
const BEDROCK_MAX_RETRIES = Math.max(0, Number(process.env.BEDROCK_MAX_RETRIES ?? 4));
const BEDROCK_BASE_BACKOFF_MS = 500;
const BEDROCK_MAX_BACKOFF_MS = Number(process.env.BEDROCK_MAX_BACKOFF_MS ?? 30_000);

function baseUrl(model: string): string {
  // The modelId goes in the PATH and contains ':' (e.g. ...-v1:0) — encode it so the colon
  // isn't misread, matching the AWS runtime's own URL construction.
  return `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;
}

function invokeUrl(model: string): string {
  // Embeddings (and other non-conversational models like Titan) use the InvokeModel endpoint,
  // not Converse. Same PATH-encoding concern for the ':' in the modelId.
  return `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`;
}

let bedrockInFlight = 0;
const bedrockWaiters: (() => void)[] = [];

async function acquireBedrockSlot(): Promise<void> {
  if (bedrockInFlight < BEDROCK_MAX_CONCURRENCY) {
    bedrockInFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => bedrockWaiters.push(resolve));
  bedrockInFlight += 1;
}

function releaseBedrockSlot(): void {
  bedrockInFlight -= 1;
  const next = bedrockWaiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff for retry attempt N (0-based): honor a server Retry-After (seconds) when present, else
 * exponential (500ms, 1s, 2s…) capped, with deterministic jitter (no Math.random in this codebase). */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(retryAfterSec * 1000, BEDROCK_MAX_BACKOFF_MS);
  const expo = Math.min(BEDROCK_BASE_BACKOFF_MS * 2 ** attempt, BEDROCK_MAX_BACKOFF_MS);
  return expo + Math.floor((expo / 2) * ((bedrockInFlight % 7) / 7));
}

/** Fetch with the concurrency slot held, retrying 429 (ThrottlingException) and 5xx with backoff.
 * Non-retryable 4xx (400/403/404) throw immediately. Returns the successful Response. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  await acquireBedrockSlot();
  try {
    let lastErrText = "";
    for (let attempt = 0; attempt <= BEDROCK_MAX_RETRIES; attempt++) {
      const res = await fetch(url, init);
      if (res.ok) return res;

      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === BEDROCK_MAX_RETRIES) {
        throw new Error(`Bedrock request failed (${res.status}): ${await res.text()}`);
      }
      lastErrText = `${res.status}`;
      const wait = backoffMs(attempt, res.headers.get("retry-after"));
      logger.warn(`bedrockClient: ${lastErrText} (throttled/transient) — retrying in ${wait}ms (attempt ${attempt + 1}/${BEDROCK_MAX_RETRIES})`);
      await sleep(wait);
    }
    throw new Error(`Bedrock request failed after retries: ${lastErrText}`);
  } finally {
    releaseBedrockSlot();
  }
}

// ── Converse API request/response shapes (only the fields we use) ──
interface ConverseResponse {
  output?: {
    message?: {
      content?: ({ text?: string } & { toolUse?: { name: string; input: unknown } })[];
    };
  };
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Bedrock Converse content blocks. System prompt is a top-level `system` array; messages carry
 * `content: [{text}]` blocks. Tools use `toolConfig` with `toolChoice.tool` to FORCE one named
 * tool — the Converse equivalent of OpenAI's tool_choice-by-name / Gemini's ANY-mode. */
async function converse(opts: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool?: JsonSchemaTool;
}): Promise<ConverseResponse | null> {
  if (!BEDROCK_BEARER_TOKEN) return null;
  assertGlobalLlmUsageAvailable();

  const body: Record<string, unknown> = {
    messages: opts.messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
    inferenceConfig: { maxTokens: opts.maxTokens },
    ...(opts.system ? { system: [{ text: opts.system }] } : {}),
    ...(opts.tool
      ? {
          toolConfig: {
            tools: [{ toolSpec: { name: opts.tool.name, description: opts.tool.description, inputSchema: { json: opts.tool.input_schema } } }],
            toolChoice: { tool: { name: opts.tool.name } },
          },
        }
      : {}),
  };

  const res = await fetchWithRetry(baseUrl(opts.model), {
    method: "POST",
    headers: { Authorization: `Bearer ${BEDROCK_BEARER_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ConverseResponse;
}

export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  const model = opts.model ?? BEDROCK_DEFAULT_MODEL;
  const response = await converse({ model, maxTokens: opts.maxTokens, system: opts.system, messages: opts.messages, tool: opts.tool });
  if (!response) return null;

  recordTokens({ provider: "bedrock", model, kind: "structured", inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 });
  recordGlobalLlmUsage((response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0));

  // The forced tool call's `input` is already-parsed JSON (Converse hands back a structured
  // object, so no JSON.parse needed).
  const toolUse = response.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
  if (!toolUse || toolUse.input == null) return null;
  return toolUse.input as T;
}

export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  const model = opts.model ?? BEDROCK_DEFAULT_MODEL;
  const response = await converse({ model, maxTokens: opts.maxTokens, system: opts.system, messages: opts.messages });
  if (!response) return null;

  recordTokens({ provider: "bedrock", model, kind: "text", inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 });
  recordGlobalLlmUsage((response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0));

  // Concatenate every text block (Converse can split a long answer across blocks); null if none.
  const text = response.output?.message?.content?.map((c) => c.text ?? "").join("").trim();
  return text ? text : null;
}

export function isBedrockConfigured(): boolean {
  return BEDROCK_BEARER_TOKEN !== undefined && BEDROCK_BEARER_TOKEN.length > 0;
}

// ── Titan Text Embeddings V2 (InvokeModel) ──
interface TitanEmbeddingResponse {
  embedding?: number[];
  inputTextTokenCount?: number;
}

/**
 * Single-text embedding via Amazon Titan Text Embeddings V2 (Research Memory / RAG). Returns the
 * embedding vector, or null when Bedrock isn't configured — same "not configured → null" contract
 * the chat calls use, so callers can treat it uniformly. `normalize:true` yields unit vectors so
 * app-side cosine similarity is a plain dot product.
 */
export async function createEmbedding(text: string): Promise<number[] | null> {
  if (!BEDROCK_BEARER_TOKEN) return null;
  assertGlobalLlmUsageAvailable();

  const res = await fetchWithRetry(invokeUrl(BEDROCK_EMBEDDING_MODEL), {
    method: "POST",
    headers: { Authorization: `Bearer ${BEDROCK_BEARER_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ inputText: text, dimensions: BEDROCK_EMBEDDING_DIMENSIONS, normalize: true }),
  });
  const json = (await res.json()) as TitanEmbeddingResponse;
  if (!Array.isArray(json.embedding)) return null;

  // Titan reports only input tokens for embeddings (no generation) — record for end-to-end profiling.
  recordTokens({ provider: "bedrock", model: BEDROCK_EMBEDDING_MODEL, kind: "embedding", inputTokens: json.inputTextTokenCount ?? 0, outputTokens: 0 });
  recordGlobalLlmUsage(json.inputTextTokenCount ?? 0);
  return json.embedding;
}
