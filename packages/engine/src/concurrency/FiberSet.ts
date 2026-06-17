import { Fiber } from './Fiber.js';
import { Scope } from './Scope.js';

export class FiberSet {
  private fibers: Fiber[] = [];
  private scope: Scope;

  constructor() {
    this.scope = new Scope();
  }

  run<T>(name: string, fn: (signal: AbortSignal) => Promise<T>): Fiber<T> {
    const fiber = Fiber.spawn(name, fn, this.scope);
    this.fibers.push(fiber);
    return fiber;
  }

  async joinAll<T>(): Promise<T[]> {
    const results = await Promise.allSettled(this.fibers.map(f => f.join()));
    this.fibers = [];
    return results
      .filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  get pending(): number { return this.fibers.length; }

  cancelAll(): void {
    this.scope.dispose();
    this.fibers = [];
  }
}
