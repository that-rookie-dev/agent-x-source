import { createHash } from 'node:crypto';
import type { ICache } from '../../cache/ICache.js';

export interface MemoryCacheServiceOptions {
  /** Time-to-live in milliseconds; 0 disables caching. */
  ttlMs?: number;
  /** Maximum number of cached entries before evicting the oldest. */
  maxSize?: number;
  /** Optional shared cache (Redis/Local) for cross-process sharing. */
  cache?: ICache;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {} as Record<string, unknown>);
    }
    return val;
  });
}

function computeKey(parts: unknown[]): string {
  return createHash('sha256').update(stableStringify(parts)).digest('hex');
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache for memory subsystem expensive operations: embeddings and vector search
 * results. It uses a simple TTL-backed Map and is intentionally separate from
 * the storage cache so eviction does not affect memory persistence.
 */
export class MemoryCacheService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private ttlMs: number;
  private maxSize: number;
  private sharedCache: ICache | undefined;
  private hits = 0;
  private misses = 0;

  constructor(options: MemoryCacheServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxSize = options.maxSize ?? 1_000;
    this.sharedCache = options.cache;
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get<T>(key: string): T | undefined {
    if (!this.enabled) {
      this.misses++;
      return undefined;
    }
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    if (!this.enabled) return;
    this.enforceMaxSize();
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  getHitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  computeKey(namespace: string, input: unknown): string {
    return `${namespace}:${computeKey([input])}`;
  }

  async compute<T>(key: string, factory: () => Promise<T>, options?: { shouldCache?: (value: T) => boolean }): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    if (this.sharedCache && this.enabled) {
      try {
        const shared = await this.sharedCache.get<T>(key);
        if (shared !== undefined && shared !== null) {
          this.set(key, shared);
          return shared;
        }
      } catch {
        // fall through to local compute
      }
    }

    const value = await factory();
    if (options?.shouldCache?.(value) ?? true) {
      this.set(key, value);
      if (this.sharedCache && this.enabled) {
        try {
          await this.sharedCache.set(key, value, Math.ceil(this.ttlMs / 1000));
        } catch {
          // ignore shared cache write errors
        }
      }
    }
    return value;
  }

  async getOrComputeEmbedding(text: string, factory: () => Promise<number[]>): Promise<number[]> {
    return this.compute(this.computeKey('embedding', text), factory);
  }

  async getOrComputeVectorSearch(key: string, factory: () => Promise<unknown[]>): Promise<unknown[]> {
    return this.compute(this.computeKey('vector', key), factory);
  }

  /**
   * Explicitly invalidate cache entries.
   * When namespace is provided, only keys matching that namespace prefix are removed.
   * When pattern is provided, keys matching the regex are removed.
   */
  invalidate(filter?: { namespace?: string; pattern?: RegExp }): void {
    if (!filter) {
      this.cache.clear();
      return;
    }
    const prefix = filter.namespace ? `${filter.namespace}:` : undefined;
    for (const key of this.cache.keys()) {
      if (prefix && key.startsWith(prefix)) {
        this.cache.delete(key);
      } else if (filter.pattern && filter.pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  private enforceMaxSize(): void {
    if (this.cache.size < this.maxSize) return;
    const oldest = this.cache.keys().next().value as string | undefined;
    if (oldest) this.cache.delete(oldest);
  }
}
