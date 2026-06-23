import { Deferred } from './Deferred.js';
import { getLogger } from '@agentx/shared';

/**
 * Simple async mutex with FIFO ordering, acquire timeout, and deadlock detection.
 */
export class Mutex {
  private locked = false;
  private queue: Array<Deferred<void>> = [];
  private acquiredAt = 0;
  private readonly LOCK_WARN_MS = 30000;
  private _warnTimer: ReturnType<typeof setTimeout> | null = null;

  get isLocked(): boolean {
    return this.locked;
  }

  get heldForMs(): number {
    return this.locked ? Date.now() - this.acquiredAt : 0;
  }

  async acquire(timeoutMs?: number): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      this.acquiredAt = Date.now();
      this._startWarnTimer();
      return;
    }
    if (timeoutMs !== undefined) {
      const deferred = new Deferred<void>();
      this.queue.push(deferred);
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(deferred);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
          deferred.reject(new Error(`Mutex acquire timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      try {
        await deferred.promise;
        clearTimeout(timer);
        this.acquiredAt = Date.now();
        this._startWarnTimer();
      } catch (e) {
        clearTimeout(timer);
        throw e;
      }
      return;
    }
    const deferred = new Deferred<void>();
    this.queue.push(deferred);
    await deferred.promise;
    this.acquiredAt = Date.now();
    this._startWarnTimer();
  }

  release(): void {
    this._clearWarnTimer();
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    } else {
      this.locked = false;
      this.acquiredAt = 0;
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

  private _startWarnTimer(): void {
    this._clearWarnTimer();
    this._warnTimer = setTimeout(() => {
      getLogger().warn('MUTEX', `Lock held for ${this.LOCK_WARN_MS / 1000}s — possible deadlock`);
    }, this.LOCK_WARN_MS);
  }

  private _clearWarnTimer(): void {
    if (this._warnTimer) {
      clearTimeout(this._warnTimer);
      this._warnTimer = null;
    }
  }
}
