import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryCacheService } from '../src/services/memory/MemoryCacheService.js';

describe('MemoryCacheService', () => {
  let cache: MemoryCacheService;

  beforeEach(() => {
    cache = new MemoryCacheService({ ttlMs: 1000, maxSize: 3 });
  });

  it('caches and returns a computed value', async () => {
    const factory = vi.fn().mockResolvedValue([1, 2, 3]);
    const r1 = await cache.getOrComputeEmbedding('hello', factory);
    const r2 = await cache.getOrComputeEmbedding('hello', factory);
    expect(r1).toEqual([1, 2, 3]);
    expect(r2).toEqual([1, 2, 3]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does not cache when disabled', async () => {
    const disabled = new MemoryCacheService({ ttlMs: 0 });
    const factory = vi.fn().mockResolvedValue([4, 5, 6]);
    await disabled.getOrComputeEmbedding('x', factory);
    await disabled.getOrComputeEmbedding('x', factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when max size is exceeded', async () => {
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    await cache.set('d', 4);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
  });

  it('expires entries after TTL', async () => {
    await cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(cache.get('key')).toBeUndefined();
  });
});
