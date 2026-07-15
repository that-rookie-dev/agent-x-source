import { createHash } from 'node:crypto';
import type { ToolDefinition } from '@agentx/shared';
import type { ICache } from '../../cache/ICache.js';

export interface ToolCacheServiceOptions {
  /** Time-to-live in milliseconds. 0 (default) disables caching. */
  ttlMs?: number;
  /** Maximum number of entries to retain. 0 disables the limit. */
  maxSize?: number;
  /** Whether caching is enabled at all. */
  enabled?: boolean;
  /** Optional shared cache (Redis/Local) for cross-process sharing. */
  cache?: ICache;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Lightweight, synchronous tool-result cache.
 *
 * TTL is configured in milliseconds for sub-second control. A TTL of 0 or
 * enabled=false disables writes and always returns undefined on read.
 */
export class ToolCacheService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private metadataCache = new Map<string, CacheEntry<unknown>>();
  private ttlMs: number;
  private maxSize: number;
  private enabled: boolean;
  private sharedCache: ICache | undefined;

  constructor(options?: ToolCacheServiceOptions) {
    this.ttlMs = options?.ttlMs ?? 0;
    this.maxSize = options?.maxSize ?? 0;
    this.enabled = options?.enabled ?? true;
    this.sharedCache = options?.cache;
  }

  get enabledValue(): boolean {
    return this.enabled && this.ttlMs > 0;
  }

  get ttl(): number {
    return this.ttlMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const effectiveTtl = ttlMs ?? this.ttlMs;
    if (!this.enabled || effectiveTtl <= 0) return;
    this.enforceMaxSize();
    this.cache.set(key, { value, expiresAt: Date.now() + effectiveTtl });
  }

  async compute<T>(
    key: string,
    factory: () => Promise<T> | T,
    options?: { ttlMs?: number; shouldCache?: (value: T) => boolean },
  ): Promise<T> {
    const existing = this.get<T>(key);
    if (existing !== undefined) return existing;

    if (this.sharedCache && this.enabled && this.ttlMs > 0) {
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
    const shouldCache = options?.shouldCache?.(value) ?? true;
    if (shouldCache) {
      this.set(key, value, options?.ttlMs);
      if (this.sharedCache && this.enabled && this.ttlMs > 0) {
        try {
          await this.sharedCache.set(key, value, Math.ceil((options?.ttlMs ?? this.ttlMs) / 1000));
        } catch {
          // ignore shared cache write errors
        }
      }
    }
    return value;
  }

  /** Fetch cached tool metadata, or undefined if not cached. */
  getMetadata<T>(toolName: string, version?: string): T | undefined {
    const key = this.metadataKey(toolName, version);
    const entry = this.metadataCache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.metadataCache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Cache tool metadata. */
  setMetadata<T>(toolName: string, version: string | undefined, value: T, ttlMs?: number): void {
    const effectiveTtl = ttlMs ?? this.ttlMs;
    if (!this.enabled || effectiveTtl <= 0) return;
    const key = this.metadataKey(toolName, version);
    this.metadataCache.set(key, { value, expiresAt: Date.now() + effectiveTtl });
  }

  /** Get or compute tool metadata, using the cache when enabled. */
  async getOrComputeMetadata<T>(
    toolName: string,
    version: string | undefined,
    factory: () => Promise<T> | T,
    ttlMs?: number,
  ): Promise<T> {
    const cached = this.getMetadata<T>(toolName, version);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.setMetadata(toolName, version, value, ttlMs);
    return value;
  }

  /** Cache a list of all tool metadata. */
  getToolList(): ToolDefinition[] | undefined {
    return this.getMetadata<ToolDefinition[]>('__all__');
  }

  setToolList(value: ToolDefinition[], ttlMs?: number): void {
    this.setMetadata('__all__', undefined, value, ttlMs);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.metadataCache.clear();
  }

  invalidateMetadata(toolName?: string, version?: string): void {
    if (toolName === undefined) {
      this.metadataCache.clear();
    } else {
      this.metadataCache.delete(this.metadataKey(toolName, version));
    }
  }

  get size(): number {
    return this.cache.size;
  }

  computeKey(toolId: string, args: Record<string, unknown>): string {
    const payload = `${toolId}:${stableStringify(args)}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  private metadataKey(toolName: string, version?: string): string {
    return `metadata:${toolName}:${version ?? ''}`;
  }

  private enforceMaxSize(): void {
    if (this.maxSize <= 0 || this.cache.size < this.maxSize) return;
    const first = this.cache.keys().next().value as string | undefined;
    if (first !== undefined) {
      this.cache.delete(first);
    }
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const entries = Object.entries(v).sort(([a], [b]) => a.localeCompare(b));
      return Object.fromEntries(entries);
    }
    return v;
  });
}
