/**
 * Limits concurrent CPU-bound background work (embeddings, ingestion, neural jobs).
 * Thread count is controlled via RuntimeSettings; this pool limits parallel task slots.
 */
export class BackgroundTaskPool {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent = 1) {}

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, Math.min(8, n));
    this.drain();
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const runTask = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.drain();
          });
      };
      if (this.active < this.maxConcurrent) {
        runTask();
      } else {
        this.queue.push(runTask);
      }
    });
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }
}

let _pool: BackgroundTaskPool | null = null;

export function getBackgroundTaskPool(): BackgroundTaskPool {
  if (!_pool) _pool = new BackgroundTaskPool(1);
  return _pool;
}

export function configureBackgroundTaskPool(maxConcurrent: number): void {
  getBackgroundTaskPool().setMaxConcurrent(maxConcurrent);
}
