/**
 * Simple TTL + max-size cache for hot read paths (session metadata, URL safety, etc.).
 */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private ttlMs: number,
    private maxSize = 256,
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxSize) {
      const first = this.store.keys().next().value;
      if (first) this.store.delete(first);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
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
