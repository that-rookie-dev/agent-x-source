import { describe, it, expect, vi } from 'vitest';
import { InMemoryQueue } from '../src/queue/InMemoryQueue.js';

describe('InMemoryQueue', () => {
  it('enqueues and processes a job', async () => {
    const queue = new InMemoryQueue();
    const processed: unknown[] = [];
    queue.registerWorker('test', async (data) => {
      processed.push(data);
    });
    await queue.start();
    const id = await queue.enqueue('test', { value: 1 });
    await vi.waitUntil(async () => (await queue.getJob(id))?.status === 'completed');
    const job = await queue.getJob(id);
    expect(job?.status).toBe('completed');
    expect(job?.data).toEqual({ value: 1 });
    expect(processed.length).toBe(1);
  });

  it('handles delayed jobs', async () => {
    const queue = new InMemoryQueue();
    const processed: number[] = [];
    queue.registerWorker('test', async (data) => {
      processed.push((data as { n: number }).n);
    });
    await queue.start();
    const start = Date.now();
    const id = await queue.enqueue('test', { n: 1 }, { delay: 50 });
    await vi.waitUntil(async () => (await queue.getJob(id))?.status === 'completed');
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
    expect(processed).toEqual([1]);
  });

  it('respects priority', async () => {
    const queue = new InMemoryQueue();
    const order: number[] = [];
    queue.registerWorker('test', async (data) => {
      order.push((data as { n: number }).n);
    });
    await queue.start();
    await queue.enqueue('test', { n: 1 }, { priority: 0 });
    await queue.enqueue('test', { n: 2 }, { priority: 1 });
    await vi.waitUntil(() => order.length === 2);
    expect(order).toEqual([2, 1]);
  });

  it('retries failed jobs', async () => {
    const queue = new InMemoryQueue();
    let attempts = 0;
    queue.registerWorker('test', async (_, ctx) => {
      attempts++;
      if (ctx.attempt === 1) throw new Error('fail');
    });
    await queue.start();
    const id = await queue.enqueue('test', {}, { retries: 1 });
    await vi.waitUntil(() => attempts === 2);
    const job = await queue.getJob(id);
    expect(job?.status).toBe('completed');
  });

  it('cancels a job', async () => {
    const queue = new InMemoryQueue();
    queue.registerWorker('test', async (_, ctx) => {
      await new Promise<void>((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    await queue.start();
    const id = await queue.enqueue('test');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = await queue.cancel(id);
    expect(cancelled).toBe(true);
    const job = await queue.getJob(id);
    expect(job?.status).toBe('cancelled');
  });

  it('fails a job with no handler', async () => {
    const queue = new InMemoryQueue();
    await queue.start();
    const id = await queue.enqueue('unknown');
    await vi.waitUntil(async () => (await queue.getJob(id))?.status === 'failed');
    const job = await queue.getJob(id);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('No handler');
  });
});
