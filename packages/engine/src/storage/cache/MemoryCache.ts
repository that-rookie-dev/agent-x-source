/**
 * Generic in-memory cache with async DB persistence.
 * Used by Secret Sauce managers to avoid DB round-trips during LLM calls.
 *
 * - Reads hit cache first; cache-miss → DB → populate cache
 * - Writes update cache immediately, then async flush to DB (debounced)
 * - On shutdown, all dirty entries are flushed
 */
export class MemoryCache<T> {
  private cache = new Map<string, { data: T; dirty: boolean }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs: number;

  constructor(
    private repo: {
      get: (key: string) => Promise<T | null>;
      getAll?: () => Promise<T[]>;
      set?: (key: string, data: T) => Promise<void>;
    },
    flushIntervalMs = 3000,
  ) {
    this.flushIntervalMs = flushIntervalMs;
  }

  /** Get a single item. Cache hit → return. Miss → fetch → cache → return. */
  async get(key: string): Promise<T | null> {
    const cached = this.cache.get(key);
    if (cached) return cached.data;

    const data = await this.repo.get(key);
    if (data !== null) {
      this.cache.set(key, { data, dirty: false });
    }
    return data;
  }

  /** Get all items. Primes the entire cache from DB. */
  async getAll(): Promise<T[]> {
    if (!this.repo.getAll) return [];
    const all = await this.repo.getAll();
    for (const item of all) {
      const keyedItem = item as { id?: string; key?: string };
      const key = keyedItem.id ?? keyedItem.key ?? JSON.stringify(item).slice(0, 32);
      this.cache.set(key, { data: item, dirty: false });
    }
    return all;
  }

  /** Set a single item. Updates cache immediately, schedules async flush. */
  set(key: string, data: T): void {
    this.cache.set(key, { data, dirty: true });
    this.scheduleFlush();
  }

  /** Flush all dirty entries to DB. */
  async flush(): Promise<void> {
    if (!this.repo.set) return;
    const promises: Promise<void>[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.dirty) {
        promises.push(this.repo.set(key, entry.data).then(() => {
          entry.dirty = false;
        }).catch(() => {}));
      }
    }
    await Promise.all(promises);
  }

  /** Shutdown: flush + clear timer. Call before app exit. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Delete a key from cache. */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Clear entire cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of cached entries. */
  get size(): number {
    return this.cache.size;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }
}
