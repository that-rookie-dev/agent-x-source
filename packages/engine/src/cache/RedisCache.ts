import type { ICache } from './ICache.js';
import { LocalCache } from './LocalCache.js';

export type RedisClient = {
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { EX: number }): Promise<string | null>;
  del(key: string): Promise<number>;
  flushAll(): Promise<string>;
  quit(): Promise<void>;
  on(event: 'error', cb: (err: Error) => void): RedisClient;
};

export interface RedisCacheOptions {
  /** Redis URL. Defaults to REDIS_URL env var. */
  url?: string;
  /** Existing Redis client to use instead of creating one. */
  client?: RedisClient;
  /** Cache to use when Redis is unavailable or not configured. */
  fallback?: ICache;
}

/**
 * Redis-backed ICache implementation.
 *
 * Falls back to LocalCache when:
 * - REDIS_URL / options.url is not set
 * - the `redis` package is not installed
 * - the Redis connection fails
 */
export class RedisCache implements ICache {
  private url: string | undefined;
  private fallback: ICache;
  private client: RedisClient | undefined;
  private clientPromise: Promise<RedisClient | undefined> | undefined;
  private connected = false;

  constructor(options: RedisCacheOptions = {}) {
    this.url = options.url ?? process.env['REDIS_URL'];
    this.fallback = options.fallback ?? new LocalCache();

    if (options.client) {
      this.client = options.client;
      this.connected = true;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const client = await this.getClient();
    if (!client) return this.fallback.get<T>(key);

    try {
      const raw = await client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      this.connected = false;
      return this.fallback.get<T>(key);
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      await this.fallback.set(key, value, ttlSeconds);
      return;
    }

    try {
      const opts = ttlSeconds ? { EX: ttlSeconds } : undefined;
      await client.set(key, JSON.stringify(value), opts);
    } catch {
      this.connected = false;
      await this.fallback.set(key, value, ttlSeconds);
    }
  }

  async delete(key: string): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      await this.fallback.delete(key);
      return;
    }

    try {
      await client.del(key);
    } catch {
      this.connected = false;
      await this.fallback.delete(key);
    }
  }

  async clear(): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      await this.fallback.clear();
      return;
    }

    try {
      await client.flushAll();
    } catch {
      this.connected = false;
      await this.fallback.clear();
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Disconnect from Redis. Safe to call multiple times. */
  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.quit();
      } catch {
        // ignore
      }
    }
    this.client = undefined;
    this.clientPromise = undefined;
    this.connected = false;
  }

  private async getClient(): Promise<RedisClient | undefined> {
    if (this.connected && this.client) return this.client;
    if (!this.url) return undefined;
    if (this.clientPromise) return this.clientPromise;

    this.clientPromise = this.createClient();
    const client = await this.clientPromise;
    if (client) {
      this.client = client;
      this.connected = true;
    }
    return client;
  }

  private async createClient(): Promise<RedisClient | undefined> {
    try {
      // Dynamic import via Function so the `redis` package is optional at build time.
      const mod = (await (Function('return import("redis")')() as Promise<unknown>)) as {
        createClient?: (options: { url: string; socket?: { connectTimeout?: number; reconnectStrategy?: false }; disableOfflineQueue?: boolean }) => RedisClient;
      };
      if (!mod.createClient) return undefined;

      const client = mod.createClient({
        url: this.url!,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: false,
        },
        disableOfflineQueue: true,
      });
      client.on('error', () => {
        this.connected = false;
      });

      await client.connect();
      return client;
    } catch {
      return undefined;
    }
  }
}
