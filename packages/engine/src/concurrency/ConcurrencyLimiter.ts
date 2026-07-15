import { Semaphore } from './Semaphore.js';

const GLOBAL_KEY = '__global__';

/**
 * Per-key + global concurrency limiter with abort-aware queuing.
 *
 * Keys can represent external API providers, worker task types, etc.
 * `acquire` returns a release callback; the caller must call it after the
 * protected work completes (use try/finally).
 */
export class ConcurrencyLimiter {
  private semaphores = new Map<string, Semaphore>();
  private globalSemaphore: Semaphore | undefined;

  /**
   * Acquire a concurrency slot scoped to `key`.
   * Resolves with a release function that must be called when done.
   */
  async acquire(key: string, maxConcurrency: number, signal?: AbortSignal): Promise<() => void> {
    const sem = this.getSemaphore(key, maxConcurrency);
    await sem.acquire(signal);
    return () => sem.release();
  }

  /**
   * Acquire a global concurrency slot.
   */
  async acquireGlobal(maxConcurrency: number, signal?: AbortSignal): Promise<() => void> {
    if (!this.globalSemaphore) {
      this.globalSemaphore = new Semaphore(Math.max(1, maxConcurrency));
    } else {
      this.globalSemaphore.setPermits(Math.max(1, maxConcurrency));
    }
    await this.globalSemaphore.acquire(signal);
    return () => this.globalSemaphore!.release();
  }

  getRunning(key: string): number {
    if (key === GLOBAL_KEY) {
      return this.globalSemaphore?.running ?? 0;
    }
    return this.semaphores.get(key)?.running ?? 0;
  }

  getQueued(key: string): number {
    if (key === GLOBAL_KEY) {
      return this.globalSemaphore?.pending ?? 0;
    }
    return this.semaphores.get(key)?.pending ?? 0;
  }

  getRunningGlobal(): number {
    return this.globalSemaphore?.running ?? 0;
  }

  getQueuedGlobal(): number {
    return this.globalSemaphore?.pending ?? 0;
  }

  private getSemaphore(key: string, maxConcurrency: number): Semaphore {
    let sem = this.semaphores.get(key);
    if (!sem) {
      sem = new Semaphore(Math.max(1, maxConcurrency));
      this.semaphores.set(key, sem);
    } else {
      sem.setPermits(Math.max(1, maxConcurrency));
    }
    return sem;
  }
}
