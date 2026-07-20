import { isMainThread, Worker, type Transferable } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { getLogger } from '@agentx/shared';

export interface WorkerTask {
  type: string;
  payload?: unknown;
}

export type WorkerTaskHandler = (task: WorkerTask) => Promise<unknown>;

export interface WorkerPoolOptions {
  /** Path to the worker script (compiled .js). Used by Node worker_threads. */
  workerPath?: string | URL;
  /** Data passed to the worker via workerData. Must be structured-cloneable. */
  workerData?: unknown;
  /** Fallback handler used when worker_threads is unavailable or spawning fails. */
  inlineHandler?: WorkerTaskHandler;
  minWorkers?: number;
  maxWorkers?: number;
  maxQueueSize?: number;
  idleTimeoutMs?: number;
}

export interface WorkerHandle {
  id: number;
  worker?: Worker;
  inlineHandler?: WorkerTaskHandler;
  busy: boolean;
  idleTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  terminated?: boolean;
  abortListener?: () => void;
  currentTaskId?: number;
  currentResolve?: (value: unknown) => void;
  currentReject?: (e: Error) => void;
}

export interface WorkerExecuteOptions {
  transferList?: Transferable[];
  timeoutMs?: number;
  signal?: AbortSignal;
  payload?: unknown;
}

interface WaitingEntry {
  resolve: (handle: WorkerHandle) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Generic worker pool backed by Node worker_threads when available.
 *
 * Falls back to an in-thread handler in test environments, browsers, or when
 * the worker script cannot be loaded. The protocol is intentionally simple:
 *   { id, task: string, payload: unknown }  -> worker
 *   { id, result?: unknown, error?: { message: string; stack?: string } } -> main
 */
export class WorkerPool {
  private options: Required<Pick<WorkerPoolOptions, 'minWorkers' | 'maxWorkers' | 'idleTimeoutMs'>> &
    Pick<WorkerPoolOptions, 'workerPath' | 'workerData' | 'inlineHandler' | 'maxQueueSize'>;
  private workers: WorkerHandle[] = [];
  private waiting: WaitingEntry[] = [];
  private nextId = 0;
  private nextHandleId = 0;
  private terminated = false;
  private fallbackMode = false;

  constructor(options: WorkerPoolOptions = {}) {
    this.options = {
      minWorkers: Math.max(0, options.minWorkers ?? 0),
      maxWorkers: Math.max(1, options.maxWorkers ?? 1),
      idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
      workerPath: options.workerPath,
      workerData: options.workerData,
      inlineHandler: options.inlineHandler,
      maxQueueSize: options.maxQueueSize,
    };
    if (!this.options.workerPath) {
      this.fallbackMode = true;
    }
    // Spawn min workers lazily on first use to avoid side effects during import.
  }

  getSize(): number {
    return this.workers.length;
  }

  getIdleSize(): number {
    return this.workers.filter((h) => !h.busy && !h.terminated).length;
  }

  async acquire(signal?: AbortSignal): Promise<WorkerHandle> {
    if (this.terminated) throw new Error('WorkerPool terminated');
    if (signal?.aborted) throw new Error('WorkerPool acquire aborted');

    this.ensureMinWorkers();

    const idle = this.workers.find((h) => !h.busy && !h.terminated);
    if (idle) {
      this.prepareHandle(idle);
      return idle;
    }

    if (this.workers.length < this.options.maxWorkers) {
      return this.createWorker();
    }

    if (this.options.maxQueueSize !== undefined && this.waiting.length >= this.options.maxQueueSize) {
      throw new Error('WorkerPool queue full');
    }

    return new Promise<WorkerHandle>((resolve, reject) => {
      const entry: WaitingEntry = { resolve, reject, signal };
      if (signal) {
        entry.onAbort = () => {
          const idx = this.waiting.indexOf(entry);
          if (idx >= 0) this.waiting.splice(idx, 1);
          reject(new Error('WorkerPool acquire aborted'));
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.waiting.push(entry);
    });
  }

  release(handle: WorkerHandle): void {
    if (handle.terminated) {
      this.removeWorker(handle);
      return;
    }

    if (handle.timeoutTimer) {
      clearTimeout(handle.timeoutTimer);
      handle.timeoutTimer = undefined;
    }
    if (handle.abortListener && handle.worker) {
      try {
        handle.worker.removeListener('error', handle.abortListener);
      } catch { /* ignore */ }
      handle.abortListener = undefined;
    }

    handle.busy = false;
    handle.currentTaskId = undefined;
    handle.currentResolve = undefined;
    handle.currentReject = undefined;

    if (this.waiting.length > 0) {
      let next = this.waiting.shift();
      while (next && next.signal?.aborted) {
        next.reject(new Error('WorkerPool acquire aborted'));
        next = this.waiting.shift();
      }
      if (next) {
        if (next.signal && next.onAbort) {
          try { next.signal.removeEventListener('abort', next.onAbort); } catch { /* ignore */ }
        }
        handle.busy = true;
        next.resolve(handle);
        return;
      }
    }

    if (this.workers.length > this.options.minWorkers && this.options.idleTimeoutMs > 0 && this.options.idleTimeoutMs < Infinity) {
      handle.idleTimer = setTimeout(() => {
        if (!handle.busy && !handle.terminated && this.workers.length > this.options.minWorkers) {
          this.terminateWorker(handle);
        }
      }, this.options.idleTimeoutMs);
    }
  }

  async execute<T>(task: WorkerTask | string, opts?: WorkerExecuteOptions): Promise<T> {
    const resolved: WorkerTask = typeof task === 'string' ? { type: task, payload: opts?.payload } : task;
    const handle = await this.acquire(opts?.signal);
    if (opts?.signal?.aborted) {
      this.release(handle);
      throw new Error('WorkerPool execute aborted');
    }
    try {
      return await this.runTaskOnHandle<T>(handle, resolved, opts);
    } finally {
      this.release(handle);
    }
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    for (const entry of this.waiting.splice(0)) {
      if (entry.signal && entry.onAbort) {
        try { entry.signal.removeEventListener('abort', entry.onAbort); } catch { /* ignore */ }
      }
      entry.reject(new Error('WorkerPool terminated'));
    }
    for (const handle of this.workers) {
      this.terminateWorker(handle);
    }
    this.workers = [];
  }

  private ensureMinWorkers(): void {
    const needed = Math.min(this.options.minWorkers, this.options.maxWorkers) - this.workers.length;
    for (let i = 0; i < needed; i++) {
      void this.createWorker().catch((err) => {
        getLogger().warn('WORKER_POOL', `Failed to create min worker: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private createWorker(): Promise<WorkerHandle> {
    if (this.fallbackMode || !this.options.workerPath) {
      return Promise.resolve(this.createInlineHandle());
    }

    return new Promise<WorkerHandle>((resolve, reject) => {
      try {
        const workerPath = this.options.workerPath!;
        const filename = workerPath instanceof URL ? fileURLToPath(workerPath) : workerPath;
        const worker = new Worker(filename, {
          workerData: this.options.workerData,
          env: process.env,
        });
        const handle: WorkerHandle = {
          id: this.nextHandleId++,
          worker,
          busy: false,
        };

        worker.on('message', (msg: unknown) => this.handleWorkerMessage(handle, msg as { id: number; result?: unknown; error?: { message: string; stack?: string } }));
        worker.on('error', (err: Error) => this.handleWorkerError(handle, err));
        worker.on('exit', (code: number) => {
          if (code !== 0 && handle.currentReject) {
            handle.currentReject(new Error(`Worker exited with code ${code}`));
          }
          this.removeWorker(handle);
        });

        this.prepareHandle(handle);
        this.workers.push(handle);
        resolve(handle);
      } catch (err) {
        if (this.options.inlineHandler) {
          this.fallbackMode = true;
          resolve(this.createInlineHandle());
        } else {
          reject(err);
        }
      }
    });
  }

  private createInlineHandle(): WorkerHandle {
    const handle: WorkerHandle = {
      id: this.nextHandleId++,
      inlineHandler: this.options.inlineHandler,
      busy: false,
    };
    this.prepareHandle(handle);
    this.workers.push(handle);
    return handle;
  }

  private prepareHandle(handle: WorkerHandle): void {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
      handle.idleTimer = undefined;
    }
    handle.busy = true;
  }

  private removeWorker(handle: WorkerHandle): void {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
      handle.idleTimer = undefined;
    }
    if (handle.timeoutTimer) {
      clearTimeout(handle.timeoutTimer);
      handle.timeoutTimer = undefined;
    }
    if (handle.abortListener && handle.worker) {
      try { handle.worker.removeListener('error', handle.abortListener); } catch { /* ignore */ }
    }
    handle.terminated = true;
    const idx = this.workers.indexOf(handle);
    if (idx >= 0) this.workers.splice(idx, 1);
  }

  private terminateWorker(handle: WorkerHandle, reason?: Error): void {
    if (handle.terminated) return;
    this.removeWorker(handle);
    if (handle.currentReject) {
      handle.currentReject(reason ?? new Error('Worker terminated'));
    }
    if (handle.worker) {
      try { handle.worker.terminate().catch(() => {}); } catch { /* ignore */ }
    }
  }

  private handleWorkerMessage(handle: WorkerHandle, msg: { id: number; result?: unknown; error?: { message: string; stack?: string } }): void {
    if (handle.terminated || handle.currentTaskId === undefined || msg.id !== handle.currentTaskId) return;
    if (handle.timeoutTimer) {
      clearTimeout(handle.timeoutTimer);
      handle.timeoutTimer = undefined;
    }
    if (handle.abortListener && handle.worker) {
      try { handle.worker.removeListener('error', handle.abortListener); } catch { /* ignore */ }
      handle.abortListener = undefined;
    }
    if (msg.error) {
      const err = new Error(msg.error.message);
      if (msg.error.stack) {
        try { (err as Error & { stack: string }).stack = msg.error.stack; } catch { /* ignore */ }
      }
      handle.currentReject?.(err);
    } else {
      handle.currentResolve?.(msg.result);
    }
    handle.currentTaskId = undefined;
    handle.currentResolve = undefined;
    handle.currentReject = undefined;
  }

  private handleWorkerError(handle: WorkerHandle, err: Error): void {
    getLogger().error('WORKER_POOL', `Worker error: ${err.message}`);
    if (handle.currentReject) {
      handle.currentReject(err);
    }
    this.terminateWorker(handle, err);
  }

  private runTaskOnHandle<T>(handle: WorkerHandle, task: WorkerTask, opts?: WorkerExecuteOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (handle.terminated) {
        reject(new Error('Worker terminated'));
        return;
      }
      if (opts?.signal?.aborted) {
        reject(new Error('WorkerPool execute aborted'));
        return;
      }

      const id = this.nextId++;
      handle.currentTaskId = id;
      handle.currentResolve = resolve as (value: unknown) => void;
      handle.currentReject = reject;

      if (handle.timeoutTimer) {
        clearTimeout(handle.timeoutTimer);
        handle.timeoutTimer = undefined;
      }

      if (opts?.timeoutMs && opts.timeoutMs > 0) {
        handle.timeoutTimer = setTimeout(() => {
          this.terminateWorker(handle, new Error(`Task ${task.type} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs);
      }

      if (opts?.signal) {
        handle.abortListener = () => this.terminateWorker(handle, new Error('WorkerPool execute aborted'));
        opts.signal.addEventListener('abort', handle.abortListener, { once: true });
        if (opts.signal.aborted) {
          this.terminateWorker(handle, new Error('WorkerPool execute aborted'));
          return;
        }
      }

      if (handle.worker) {
        handle.worker.postMessage({ id, task: task.type, payload: task.payload }, opts?.transferList as Transferable[] | undefined);
      } else if (handle.inlineHandler) {
        Promise.resolve(handle.inlineHandler(task))
          .then((result) => {
            if (handle.currentTaskId === id) {
              if (handle.timeoutTimer) {
                clearTimeout(handle.timeoutTimer);
                handle.timeoutTimer = undefined;
              }
              resolve(result as T);
            }
          })
          .catch((err) => {
            if (handle.currentTaskId === id) {
              if (handle.timeoutTimer) {
                clearTimeout(handle.timeoutTimer);
                handle.timeoutTimer = undefined;
              }
              reject(err);
            }
          });
      } else {
        reject(new Error('No worker or inline handler available'));
      }
    });
  }
}

/**
 * Set up the worker side of the WorkerPool protocol.
 * Call this at the top of each worker module inside `if (!isMainThread)`.
 */
export function setupWorkerListener(handler: WorkerTaskHandler): void {
  if (isMainThread) return;
  // Use a dynamic import so worker-only code is not loaded into the main thread.
  import('node:worker_threads').then((wt) => {
    const parentPort = wt.parentPort;
    if (!parentPort) return;
    parentPort.on('message', async (msg: { id: number; task: string; payload?: unknown }) => {
      try {
        const result = await handler({ type: msg.task, payload: msg.payload });
        parentPort!.postMessage({ id: msg.id, result });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        parentPort!.postMessage({ id: msg.id, error: { message: error.message, stack: error.stack } });
      }
    });
  }).catch((err) => {
    getLogger().error('WORKER', `Worker listener setup failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
