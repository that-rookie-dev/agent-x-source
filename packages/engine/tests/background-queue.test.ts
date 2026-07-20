import { describe, it, expect } from 'vitest';
import { BackgroundQueue } from '../src/session/BackgroundQueue.js';
import { InMemoryQueue } from '../src/queue/InMemoryQueue.js';

describe('BackgroundQueue', () => {
  it('runs a shell command and reports completion', async () => {
    const jobQueue = new InMemoryQueue();
    const bq = new BackgroundQueue({ jobQueue });
    const completed = new Promise<typeof task>((resolve) => bq.onComplete(resolve));
    const task = await bq.enqueue('echo hello');
    const completedTask = await completed;
    expect(completedTask).toBe(task);
    expect(task.status).toBe('completed');
    expect(task.result).toContain('hello');
    expect(task.id).toBeTruthy();
    expect(bq.getTask(task.id)).toBe(task);
    expect(bq.listTasks()).toContain(task);
  });

  it('reports failed commands', async () => {
    const jobQueue = new InMemoryQueue();
    const bq = new BackgroundQueue({ jobQueue });
    const completed = new Promise<typeof task>((resolve) => bq.onComplete(resolve));
    const task = await bq.enqueue('false');
    await completed;
    expect(task.status).toBe('failed');
  });

  it('cancels a running task', async () => {
    const jobQueue = new InMemoryQueue();
    const bq = new BackgroundQueue({ jobQueue });
    const task = await bq.enqueue('sleep 10');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const ok = await bq.cancel(task.id);
    expect(ok).toBe(true);
    expect(task.status).toBe('cancelled');
  });

  it('prunes old tasks', async () => {
    const jobQueue = new InMemoryQueue();
    const bq = new BackgroundQueue({ jobQueue, maxRetainedTasks: 2 });
    for (let i = 0; i < 3; i++) {
      const completed = new Promise<typeof task>((resolve) => bq.onComplete(resolve));
      const task = await bq.enqueue(`echo ${i}`);
      await completed;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bq.listTasks().length).toBeLessThanOrEqual(2);
  });
});
