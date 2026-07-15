import { describe, it, expect, vi } from 'vitest';
import { PgBossQueue } from '../src/queue/PgBossQueue.js';

const connectionString = process.env.AGENTX_POSTGRES_CONNECTION_STRING;

describe.skipIf(!connectionString)('PgBossQueue', () => {
  const queue = new PgBossQueue({
    connectionString: connectionString!,
    pgBossOptions: { retryLimit: 0 },
  });

  afterAll(async () => {
    await queue.stop();
  });

  it('enqueues and processes a job', async () => {
    const processed: unknown[] = [];
    queue.registerWorker('test', async (data) => {
      processed.push(data);
    });
    await queue.start();
    const id = await queue.enqueue('test', { value: 1 });
    await vi.waitUntil(() => processed.length === 1);
    const job = await queue.getJob(id);
    expect(job?.status).toBe('completed');
  });

  it('cancels a job', async () => {
    queue.registerWorker('test', async (_, ctx) => {
      await new Promise<void>((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    await queue.start();
    const id = await queue.enqueue('test');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cancelled = await queue.cancel(id);
    expect(cancelled).toBe(true);
    await vi.waitUntil(async () => (await queue.getJob(id))?.status === 'cancelled');
    const job = await queue.getJob(id);
    expect(job?.status).toBe('cancelled');
  });
});
