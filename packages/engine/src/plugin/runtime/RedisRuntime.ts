import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface RedisCacheConfig {
  url: string;
  password?: string;
  ttl: number;
  prefix: string;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

type RedisClient = {
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, opts: { EX: number }) => Promise<void>;
  del: (k: string) => Promise<void>;
  keys: (p: string) => Promise<string[]>;
  flushAll: () => Promise<void>;
  ttl: (k: string) => Promise<number>;
  quit: () => Promise<void>;
};

export class RedisCacheRuntime {
  private config: RedisCacheConfig;
  private store = new Map<string, CacheEntry>();
  private connected = false;
  private redisClient: RedisClient | null = null;

  constructor(config: Partial<RedisCacheConfig> = {}) {
    this.config = {
      url: config.url || '',
      password: config.password,
      ttl: config.ttl || 300000,
      prefix: config.prefix || 'agentx:',
    };
    if (this.config.url) {
      this.connect().catch(() => {
        logger.warn('REDIS', `Cannot connect to Redis at ${this.config.url} — using in-memory cache`);
      });
    }
  }

  private async connect(): Promise<void> {
    try {
      // Dynamic import — type-checker skips via Function wrapper
      const mod = await (Function('return import("redis")')()) as { createClient?: (o: Record<string, unknown>) => RedisClient };
      if (!mod?.createClient) return;
      const c = mod.createClient({
        url: this.config.url,
        password: this.config.password || undefined,
      }) as unknown as RedisClient & { on: (e: string, cb: () => void) => void; connect: () => Promise<void> };
      c.on('error', () => { this.connected = false; });
      await c.connect();
      this.connected = true;
      this.redisClient = c;
      logger.info('REDIS', 'Connected');
    } catch {
      this.connected = false;
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const fullKey = this.config.prefix + key;
    if (this.connected && this.redisClient) {
      try {
        const val = await this.redisClient.get(fullKey);
        if (!val) return null;
        return JSON.parse(val) as T;
      } catch { this.connected = false; }
    }
    const entry = this.store.get(fullKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(fullKey); return null; }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const fullKey = this.config.prefix + key;
    if (this.connected && this.redisClient) {
      try {
        await this.redisClient.set(fullKey, JSON.stringify(value), { EX: Math.ceil((ttl ?? this.config.ttl) / 1000) });
        return;
      } catch { this.connected = false; }
    }
    this.store.set(fullKey, { value, expiresAt: Date.now() + (ttl ?? this.config.ttl) });
  }

  async del(key: string): Promise<void> {
    const fullKey = this.config.prefix + key;
    if (this.connected && this.redisClient) {
      try { await this.redisClient.del(fullKey); return; } catch { this.connected = false; }
    }
    this.store.delete(fullKey);
  }

  async keys(pattern?: string): Promise<string[]> {
    if (this.connected && this.redisClient) {
      try {
        const raw = await this.redisClient.keys(this.config.prefix + (pattern || '*'));
        return raw.map((k) => k.replace(this.config.prefix, ''));
      } catch { this.connected = false; }
    }
    const now = Date.now();
    const result: string[] = [];
    for (const [k, e] of this.store) {
      if (e.expiresAt <= now) { this.store.delete(k); continue; }
      const sk = k.replace(this.config.prefix, '');
      if (!pattern) { result.push(sk); continue; }
      const r = new RegExp('^' + pattern.replace(/[*]/g, '.*').replace(/[?]/g, '.') + '$');
      if (r.test(sk)) result.push(sk);
    }
    return result;
  }

  async flush(): Promise<void> {
    if (this.connected && this.redisClient) {
      try { await this.redisClient.flushAll(); return; } catch { this.connected = false; }
    }
    this.store.clear();
  }

  async ttl(key: string): Promise<number> {
    const fullKey = this.config.prefix + key;
    if (this.connected && this.redisClient) {
      try { return await this.redisClient.ttl(fullKey); } catch { this.connected = false; }
    }
    const entry = this.store.get(fullKey);
    if (!entry) return -2;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  async disconnect(): Promise<void> {
    if (this.connected && this.redisClient) {
      try { await this.redisClient.quit(); } catch { /* ignore */ }
    }
    this.connected = false;
    this.redisClient = null;
  }
}
