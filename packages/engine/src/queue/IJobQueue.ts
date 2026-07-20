export interface JobEnqueueOptions {
  /** Delay in milliseconds before a job becomes available. */
  delay?: number;

  /** Number of retry attempts for failed jobs. */
  retries?: number;

  /** Priority (higher = processed earlier). */
  priority?: number;
}

export interface JobContext {
  /** Unique job id. */
  id: string;

  /** Job name. */
  name: string;

  /** Number of times this job has been attempted. */
  attempt: number;

  /** Abort signal that is raised if the queue is stopped or the job is cancelled. */
  signal: AbortSignal;
}

export type JobHandler = (data: unknown, ctx: JobContext) => Promise<void>;

export interface IJob {
  /** Unique job id. */
  id: string;

  /** Job name. */
  name: string;

  /** Job payload. */
  data: unknown;

  /** Current status. */
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

  /** Optional result/output for completed jobs. */
  result?: string;

  /** Optional error message for failed jobs. */
  error?: string;

  /** Timestamp when the job was created. */
  createdAt: number;

  /** Timestamp when it completed/failed/cancelled, if finished. */
  completedAt?: number;

  /** Attempt count. */
  attempt: number;
}

/**
 * Durable job queue contract.
 *
 * Implementations can be in-memory (for tests/local dev) or pg-boss-backed
 * (for production durability).
 */
export interface IJobQueue {
  /** Add a job to the queue. Returns the job id. */
  enqueue<T = unknown>(name: string, data: T, opts?: JobEnqueueOptions): Promise<string>;

  /** Register a handler for a named job. */
  registerWorker(name: string, handler: JobHandler): void;

  /** Start consuming jobs. */
  start(): Promise<void>;

  /** Stop consuming jobs. */
  stop(): Promise<void>;

  /** Get a job by id. */
  getJob(id: string): Promise<IJob | undefined>;

  /** Cancel a job by id. Returns true if it was found and cancelled. */
  cancel(id: string): Promise<boolean>;

  /** Return the current queue depth / active job count. */
  getQueueDepth(): number;
}
