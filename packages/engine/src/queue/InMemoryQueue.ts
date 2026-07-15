import { randomUUID } from 'node:crypto';
import type { IJobQueue, IJob, JobEnqueueOptions, JobContext, JobHandler } from './IJobQueue.js';

interface InternalJob {
  id: string;
  name: string;
  data: unknown;
  opts: Required<JobEnqueueOptions> | JobEnqueueOptions;
  attempt: number;
  status: IJob['status'];
  startAfter: number;
  createdAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  controller: AbortController;
}

export class InMemoryQueue implements IJobQueue {
  private handlers = new Map<string, JobHandler>();
  private jobs = new Map<string, InternalJob>();
  private queue: InternalJob[] = [];
  private started = false;
  private stopping = false;
  private isProcessing = false;
  private processTimer: NodeJS.Timeout | null = null;
  private stopController = new AbortController();

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.stopController = new AbortController();
    this.processLoop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    this.stopController.abort();
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
  }

  registerWorker(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async enqueue<T = unknown>(name: string, data: T, opts?: JobEnqueueOptions): Promise<string> {
    await this.start();
    const id = randomUUID();
    const now = Date.now();
    const job: InternalJob = {
      id,
      name,
      data,
      opts: opts ?? {},
      attempt: 1,
      status: 'queued',
      startAfter: now + (opts?.delay ?? 0),
      createdAt: now,
      controller: new AbortController(),
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    setImmediate(() => this.processLoop());
    return id;
  }

  async getJob(id: string): Promise<IJob | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    return this.toIJob(job);
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return false;
    }
    job.status = 'cancelled';
    job.controller.abort();
    this.queue = this.queue.filter((j) => j.id !== id);
    return true;
  }

  private toIJob(job: InternalJob): IJob {
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      attempt: job.attempt,
    };
  }

  private async processLoop(): Promise<void> {
    if (this.isProcessing || this.stopping || !this.started) return;
    this.isProcessing = true;

    while (this.queue.length && !this.stopping) {
      const job = this.getNextJob();
      if (!job) break;

      const wait = job.startAfter - Date.now();
      if (wait > 0) {
        await this.delay(wait);
        if (this.stopping) break;
      }

      await this.runJob(job);
    }

    this.isProcessing = false;
  }

  private getNextJob(): InternalJob | undefined {
    this.queue.sort((a, b) => {
      const priority = (b.opts.priority ?? 0) - (a.opts.priority ?? 0);
      if (priority !== 0) return priority;
      return a.startAfter - b.startAfter;
    });
    return this.queue.shift();
  }

  private async runJob(job: InternalJob): Promise<void> {
    if (job.controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = 'Cancelled';
      return;
    }
    const handler = this.handlers.get(job.name);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for ${job.name}`;
      job.completedAt = Date.now();
      return;
    }

    job.status = 'running';
    const ctx: JobContext = {
      id: job.id,
      name: job.name,
      attempt: job.attempt,
      signal: job.controller.signal,
    };

    try {
      await handler(job.data, ctx);
      if (this.stopping || job.controller.signal.aborted) {
        job.status = 'cancelled';
        job.error = 'Cancelled';
        return;
      }
      job.status = 'completed';
      job.completedAt = Date.now();
    } catch (err) {
      if (this.stopping || job.controller.signal.aborted) {
        job.status = 'cancelled';
        job.error = 'Cancelled';
        return;
      }
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = Date.now();

      if (job.attempt <= (job.opts.retries ?? 0)) {
        job.attempt++;
        job.status = 'queued';
        job.startAfter = Date.now();
        this.queue.push(job);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.processTimer = timer;
      const onAbort = () => {
        clearTimeout(timer);
        this.stopController.signal.removeEventListener('abort', onAbort);
        resolve();
      };
      this.stopController.signal.addEventListener('abort', onAbort);
    });
  }
}
