/**
 * Generic cache contract.
 *
 * Implementations may be in-memory (LocalCache) or backed by Redis.
 */
export interface ICache {
  /** Get a value by key. Returns null if missing or expired. */
  get<T>(key: string): Promise<T | null>;

  /** Set a value with an optional TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /** Remove a single key. */
  delete(key: string): Promise<void>;

  /** Clear all cached values. */
  clear(): Promise<void>;

  /** Return true when the cache is ready (local caches are always ready). */
  isConnected?(): boolean;
}
