export type RunState = 'idle' | 'draining';

export class SessionRunCoordinator {
  private state: RunState = 'idle';
  private wakeResolve: (() => void) | null = null;
  private queue: Array<() => Promise<void>> = [];

  get currentState(): RunState { return this.state; }

  async run<T>(_key: string, fn: () => Promise<T>): Promise<T> {
    if (this.state === 'draining') {
      return new Promise<T>((resolve) => {
        this.queue.push(async () => {
          const result = await fn();
          resolve(result);
        });
      });
    }

    this.state = 'draining';
    try {
      const result = await fn();
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        await next();
      }
      return result;
    } finally {
      this.state = 'idle';
    }
  }

  wake(): void {
    if (this.wakeResolve) {
      this.wakeResolve();
      this.wakeResolve = null;
    }
  }

  interrupt(): void {
    this.queue = [];
    this.state = 'idle';
  }
}
