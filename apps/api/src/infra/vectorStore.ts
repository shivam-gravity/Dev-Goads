import { createHash } from "node:crypto";

/**
 * Provider-agnostic embedding storage/search. Shaped after the query APIs of
 * Pinecone/pgvector/Weaviate (upsert records with an embedding + metadata,
 * query by embedding for nearest neighbors) so a real Vector DB (roadmap
 * Phase 4, once Deep Research needs semantic search) is a drop-in replacement
 * for InMemoryVectorStore.
 */
export interface VectorRecord {
  id: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(embedding: number[], topK: number): Promise<VectorMatch[]>;
  delete(ids: string[]): Promise<void>;
}

const EMBEDDING_DIMENSIONS = 256;

/**
 * Deterministic hash-based pseudo-embedding — NOT a real semantic embedding.
 * It exists only so VectorStore has a genuine caller to exercise before a real
 * embeddings provider (OpenAI, Voyage AI, etc.) is wired in; it groups
 * near-duplicate text but has none of a real model's semantic understanding.
 */
export function hashEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const word of words) {
    const hash = createHash("sha256").update(word).digest();
    const index = hash.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    vector[index] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / magnitude);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Brute-force cosine-similarity search over an in-memory array — fine at dev/demo scale. */
export class InMemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.id, record);
  }

  async query(embedding: number[], topK: number): Promise<VectorMatch[]> {
    return Array.from(this.records.values())
      .map((r) => ({ id: r.id, score: cosineSimilarity(embedding, r.embedding), metadata: r.metadata }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }
}

export const vectorStore: VectorStore = new InMemoryVectorStore();
