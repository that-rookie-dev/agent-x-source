import { Deferred } from './Deferred.js';

/**
 * Simple async mutex with FIFO ordering.
 */
export class Mutex {
  private locked = false;
  private queue: Array<Deferred<void>> = [];

  get isLocked(): boolean {
    return this.locked;
  }

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    const deferred = new Deferred<void>();
    this.queue.push(deferred);
    return deferred.promise;
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    } else {
      this.locked = false;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
