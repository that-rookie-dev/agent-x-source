import { describe, it, expect } from 'vitest';
import { LocalCache } from '../src/cache/LocalCache.js';

describe('LocalCache', () => {
  it('stores and retrieves values', async () => {
    const cache = new LocalCache();
    await cache.set('key', { value: 42 });
    const result = await cache.get<{ value: number }>('key');
    expect(result).toEqual({ value: 42 });
  });

  it('returns null for missing keys', async () => {
    const cache = new LocalCache();
    const result = await cache.get('missing');
    expect(result).toBeNull();
  });

  it('returns null for expired keys', async () => {
    const cache = new LocalCache();
    await cache.set('key', 'value', 0.001); // 1ms TTL
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await cache.get('key');
    expect(result).toBeNull();
  });

  it('deletes a key', async () => {
    const cache = new LocalCache();
    await cache.set('key', 'value');
    await cache.delete('key');
    const result = await cache.get('key');
    expect(result).toBeNull();
  });

  it('clears all values', async () => {
    const cache = new LocalCache();
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.clear();
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });
});
