import { describe, it, expect } from 'vitest';
import { WorkerPool } from '../../src/workers/WorkerPool.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('WorkerPool', () => {
  it('executes an inline task', async () => {
    const pool = new WorkerPool({
      inlineHandler: async (task) => (task.payload as { a: number; b: number }).a + (task.payload as { a: number; b: number }).b,
    });
    const result = await pool.execute<number>('add', { payload: { a: 1, b: 2 } });
    await pool.terminate();
    expect(result).toBe(3);
  });

  it('acquires and releases a worker handle', async () => {
    const pool = new WorkerPool({
      inlineHandler: async (task) => task.payload,
    });
    const handle = await pool.acquire();
    expect(handle.busy).toBe(true);
    expect(pool.getIdleSize()).toBe(0);
    pool.release(handle);
    expect(pool.getIdleSize()).toBe(1);
    await pool.terminate();
  });

  it('limits concurrency to maxWorkers', async () => {
    const pool = new WorkerPool({
      inlineHandler: async (task) => {
        await sleep(50);
        return task.payload;
      },
      maxWorkers: 2,
    });
    const p1 = pool.execute<number>('echo', { payload: 1 });
    const p2 = pool.execute<number>('echo', { payload: 2 });
    const p3 = pool.execute<number>('echo', { payload: 3 });
    expect(pool.getSize()).toBeLessThanOrEqual(2);
    const results = await Promise.all([p1, p2, p3]);
    await pool.terminate();
    expect(results.sort()).toEqual([1, 2, 3]);
  });

  it('respects maxQueueSize', async () => {
    const pool = new WorkerPool({
      inlineHandler: async (task) => {
        await sleep(100);
        return task.payload;
      },
      maxWorkers: 1,
      maxQueueSize: 1,
    });
    const p1 = pool.execute<number>('echo', { payload: 1 });
    const p2 = pool.execute<number>('echo', { payload: 2 });
    const p3 = pool.execute<number>('echo', { payload: 3 });
    const results = await Promise.allSettled([p1, p2, p3]);
    await pool.terminate();
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
  });

  it('times out long-running tasks', async () => {
    const pool = new WorkerPool({
      inlineHandler: async () => {
        await sleep(1000);
        return 'done';
      },
    });
    await expect(pool.execute('slow', { timeoutMs: 50 })).rejects.toThrow('timed out');
    await pool.terminate();
  });

  it('aborts when signal is triggered', async () => {
    const controller = new AbortController();
    const pool = new WorkerPool({
      inlineHandler: async (task) => {
        await sleep(200);
        return task.payload;
      },
    });
    setTimeout(() => controller.abort(), 25);
    await expect(pool.execute('slow', { payload: 1, signal: controller.signal })).rejects.toThrow('aborted');
    await pool.terminate();
  });

  it('rejects execute after terminate', async () => {
    const pool = new WorkerPool({
      inlineHandler: async (task) => task.payload,
    });
    await pool.terminate();
    await expect(pool.execute('echo', { payload: 1 })).rejects.toThrow('terminated');
  });
});
