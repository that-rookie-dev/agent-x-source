import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from '../../src/concurrency/ConcurrencyLimiter.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('ConcurrencyLimiter', () => {
  it('limits concurrency per key', async () => {
    const limiter = new ConcurrencyLimiter();
    const results: number[] = [];
    const tasks = Array.from({ length: 3 }, (_, i) => async () => {
      const release = await limiter.acquire('provider', 2);
      await sleep(10);
      results.push(i);
      release();
    });
    await Promise.all(tasks.map((t) => t()));
    expect(results).toHaveLength(3);
  });

  it('getRunning and getQueued reflect current state', async () => {
    const limiter = new ConcurrencyLimiter();
    const release1 = await limiter.acquire('provider', 1);
    expect(limiter.getRunning('provider')).toBe(1);
    expect(limiter.getQueued('provider')).toBe(0);

    const pending = limiter.acquire('provider', 1);
    expect(limiter.getQueued('provider')).toBe(1);

    release1();
    const release2 = await pending;
    release2();
  });

  it('supports global concurrency', async () => {
    const limiter = new ConcurrencyLimiter();
    const release = await limiter.acquireGlobal(2);
    expect(limiter.getRunningGlobal()).toBe(1);
    release();
    expect(limiter.getRunningGlobal()).toBe(0);
  });

  it('respects AbortSignal during acquire', async () => {
    const limiter = new ConcurrencyLimiter();
    const controller = new AbortController();
    const release = await limiter.acquire('provider', 1);
    const pending = limiter.acquire('provider', 1, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    release();
  });
});
