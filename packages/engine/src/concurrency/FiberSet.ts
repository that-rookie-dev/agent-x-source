import { Fiber } from './Fiber.js';
import { Scope } from './Scope.js';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

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
    const values: T[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        values.push(r.value as T);
      } else {
        logger.error('FIBER_SET', r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }
    return values;
  }

  get pending(): number { return this.fibers.length; }

  cancelAll(): void {
    this.scope.dispose();
    this.fibers = [];
  }
}
