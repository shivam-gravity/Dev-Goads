/**
 * Generic in-process TTL cache, one instance per provider (see providers/*.ts) — same
 * "process-local, no Redis/DB round-trip" tradeoff marketResearch.ts's own cache makes:
 * this only needs to survive one gateway/worker process's lifetime to absorb the common
 * case of the same URL being researched again shortly after (retry, resubmission, a
 * second workspace researching the same public site).
 */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Normalizes a provider cache key so "Example.com", "example.com/", and "https://example.com"
 * all hit the same cache entry — providers call this rather than keying on the raw input url. */
export function normalizeCacheKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}
