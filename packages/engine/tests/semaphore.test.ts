import { describe, it, expect } from 'vitest';
import { Semaphore } from '../src/concurrency/Semaphore.js';

describe('Semaphore', () => {
  it('runs up to permit count concurrently and queues the rest', async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];

    const task = (id: number) =>
      sem.run(async () => {
        running++;
        peak = Math.max(peak, running);
        order.push(id);
        await new Promise((r) => setTimeout(r, 30));
        running--;
      });

    await Promise.all([task(1), task(2), task(3), task(4)]);

    expect(peak).toBe(2);
    expect(order).toHaveLength(4);
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
  });

  it('setPermits raises capacity and drains queue', async () => {
    const sem = new Semaphore(1);
    let started = 0;
    const blockers: Array<() => void> = [];

    const hold = () =>
      sem.run(
        () =>
          new Promise<void>((resolve) => {
            started++;
            blockers.push(resolve);
          }),
      );

    const p1 = hold();
    const p2 = hold();
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(1);

    sem.setPermits(2);
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(2);

    blockers.forEach((r) => r());
    await Promise.all([p1, p2]);
  });

  it('aborts queued waiters without leaking slots', async () => {
    const sem = new Semaphore(1);
    let releaseHold!: () => void;
    const hold = sem.run(
      () =>
        new Promise<void>((resolve) => {
          releaseHold = resolve;
        }),
    );

    const ac = new AbortController();
    const queued = sem.run(async () => 'should-not-run', ac.signal);
    await new Promise((r) => setTimeout(r, 10));
    expect(sem.pending).toBe(1);

    ac.abort();
    await expect(queued).rejects.toThrow(/aborted/);
    expect(sem.pending).toBe(0);

    releaseHold();
    await hold;
    expect(sem.running).toBe(0);
  });
});
