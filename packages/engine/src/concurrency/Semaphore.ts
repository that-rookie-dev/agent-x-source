/**
 * Async semaphore — virtual concurrency slots for I/O-bound work.
 * Queues waiters when all permits are in use (never fails on limit).
 * Supports AbortSignal so cancelAll does not leak queued waiters.
 */
export class Semaphore {
  private active = 0;
  private queue: Array<{ resume: () => void; reject: (e: Error) => void; signal?: AbortSignal; onAbort?: () => void }> = [];

  constructor(private permits: number) {
    this.permits = Math.max(1, permits);
  }

  get running(): number {
    return this.active;
  }

  get pending(): number {
    return this.queue.length;
  }

  get available(): number {
    return Math.max(0, this.permits - this.active);
  }

  setPermits(n: number): void {
    this.permits = Math.max(1, n);
    this.drain();
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error('Semaphore acquire aborted');
    }
    if (this.active < this.permits) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const entry = {
        resume: () => {
          this.active++;
          resolve();
        },
        reject,
        signal,
        onAbort: undefined as (() => void) | undefined,
      };
      if (signal) {
        entry.onAbort = () => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(new Error('Semaphore acquire aborted'));
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.queue.push(entry);
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      if (signal?.aborted) {
        throw new Error('Semaphore run aborted');
      }
      return await fn();
    } finally {
      this.release();
    }
  }

  private drain(): void {
    while (this.active < this.permits && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      if (next.signal?.aborted) {
        next.reject(new Error('Semaphore acquire aborted'));
        continue;
      }
      if (next.onAbort && next.signal) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      next.resume();
    }
  }
}
