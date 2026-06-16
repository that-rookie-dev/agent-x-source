import { Fiber } from './Fiber.js';

export class Scope {
  private fibers: Set<Fiber> = new Set();
  private _disposed = false;
  private cleanupFns: Array<() => void> = [];

  get disposed(): boolean { return this._disposed; }

  acquire(fiber: Fiber): void {
    if (this._disposed) throw new Error('Cannot acquire fiber: scope already disposed');
    this.fibers.add(fiber);
    fiber.join().finally(() => this.fibers.delete(fiber));
  }

  onDispose(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const fiber of this.fibers) fiber.cancel();
    this.fibers.clear();
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }
}
