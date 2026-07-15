import { describe, expect, it } from 'vitest';
import { ToolCacheService } from '../src/services/tool/ToolCacheService.js';

describe('ToolCacheService', () => {
  it('returns undefined for missing keys', () => {
    const cache = new ToolCacheService({ ttlMs: 1000 });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('caches and retrieves values', () => {
    const cache = new ToolCacheService({ ttlMs: 1000 });
    cache.set('key', { value: 42 });
    expect(cache.get('key')).toEqual({ value: 42 });
  });

  it('expires entries after ttl', async () => {
    const cache = new ToolCacheService({ ttlMs: 1 });
    cache.set('key', { value: 42 });
    await new Promise((r) => setTimeout(r, 5));
    expect(cache.get('key')).toBeUndefined();
  });

  it('disabled when ttl is 0', () => {
    const cache = new ToolCacheService({ ttlMs: 0 });
    cache.set('key', { value: 42 });
    expect(cache.get('key')).toBeUndefined();
  });

  it('computes and caches values', async () => {
    const cache = new ToolCacheService({ ttlMs: 1000 });
    let calls = 0;
    const result = await cache.compute('key', () => {
      calls += 1;
      return { value: 42 };
    });
    expect(result).toEqual({ value: 42 });
    expect(calls).toBe(1);
    expect(cache.get('key')).toEqual({ value: 42 });
    await cache.compute('key', () => {
      calls += 1;
      return { value: 99 };
    });
    expect(calls).toBe(1);
  });

  it('compute respects shouldCache', async () => {
    const cache = new ToolCacheService({ ttlMs: 1000 });
    const result = await cache.compute(
      'key',
      () => ({ value: 42 }),
      { shouldCache: (v) => (v as { value: number }).value > 50 },
    );
    expect(result).toEqual({ value: 42 });
    expect(cache.get('key')).toBeUndefined();
  });

  it('deletes and clears entries', () => {
    const cache = new ToolCacheService({ ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('produces deterministic keys for equivalent args', () => {
    const cache = new ToolCacheService({});
    const key1 = cache.computeKey('tool', { a: 1, b: [2, 3] });
    const key2 = cache.computeKey('tool', { b: [2, 3], a: 1 });
    expect(key1).toBe(key2);
  });
});
