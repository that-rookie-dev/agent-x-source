import { describe, it, expect, vi } from 'vitest';
import { RedisCache, type RedisClient } from '../src/cache/RedisCache.js';
import { LocalCache } from '../src/cache/LocalCache.js';

function createMockRedisClient(overrides: Partial<RedisClient> = {}): RedisClient {
  const store = new Map<string, string>();

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, opts?: { EX: number }) => {
      store.set(key, value);
      if (opts?.EX) {
        setTimeout(() => store.delete(key), opts.EX * 1000);
      }
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    flushAll: vi.fn(async () => {
      store.clear();
      return 'OK';
    }),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

describe('RedisCache', () => {
  it('falls back to LocalCache when no Redis URL or client is provided', async () => {
    const fallback = new LocalCache();
    const cache = new RedisCache({ fallback });

    await cache.set('key', 'value');
    const result = await cache.get('key');
    expect(result).toBe('value');
    expect(await fallback.get('key')).toBe('value');
  });

  it('uses Redis when a client is provided', async () => {
    const client = createMockRedisClient();
    const cache = new RedisCache({ client });

    await cache.set('key', { value: 42 });
    const result = await cache.get<{ value: number }>('key');
    expect(result).toEqual({ value: 42 });
    expect(client.set).toHaveBeenCalledWith('key', JSON.stringify({ value: 42 }), undefined);
  });

  it('sets TTL when ttlSeconds is provided', async () => {
    const client = createMockRedisClient();
    const cache = new RedisCache({ client });

    await cache.set('key', 'value', 60);
    expect(client.set).toHaveBeenCalledWith('key', JSON.stringify('value'), { EX: 60 });
  });

  it('deletes keys from Redis', async () => {
    const client = createMockRedisClient();
    const cache = new RedisCache({ client });

    await cache.set('key', 'value');
    await cache.delete('key');
    expect(client.del).toHaveBeenCalledWith('key');
    expect(await cache.get('key')).toBeNull();
  });

  it('clears Redis via flushAll', async () => {
    const client = createMockRedisClient();
    const cache = new RedisCache({ client });

    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.clear();
    expect(client.flushAll).toHaveBeenCalled();
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });

  it('falls back to LocalCache when Redis calls fail', async () => {
    const fallback = new LocalCache();
    await fallback.set('key', 'value');

    const client = createMockRedisClient({
      get: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const cache = new RedisCache({ client, fallback });

    const result = await cache.get('key');
    expect(result).toBe('value');
    expect(client.get).toHaveBeenCalledWith('key');
    expect(await fallback.get('key')).toBe('value');
  });
});
