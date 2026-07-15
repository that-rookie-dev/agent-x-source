import { exec as execCallback, type ExecException } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '@agentx/shared';
import type { IJobQueue, JobContext } from '../queue/IJobQueue.js';
import { InMemoryQueue } from '../queue/InMemoryQueue.js';

/** Error from a failed exec call, carrying captured stdout/stderr. */
type ExecError = ExecException & { stdout?: string; stderr?: string };

export interface BackgroundTask {
  id: string;
  command: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: string;
  result?: string;
  createdAt: number;
  completedAt?: number;
}

export interface BackgroundQueueOptions {
  jobQueue?: IJobQueue;
  maxRetainedTasks?: number;
}

/**
 * @deprecated BackgroundQueue is being replaced by the IJobQueue abstraction.
 * It remains only for the legacy /bg command. New code should use IJobQueue
 * (InMemoryQueue or PgBossQueue) directly.
 */
export class BackgroundQueue {
  private tasks = new Map<string, BackgroundTask>();
  private jobQueue: IJobQueue;
  private readonly maxRetainedTasks: number;
  private onCompleteCallback: ((task: BackgroundTask) => void) | null = null;
  private started = false;
  private starting: Promise<void> | null = null;

  constructor(options: BackgroundQueueOptions = {}) {
    this.jobQueue = options.jobQueue ?? new InMemoryQueue();
    this.maxRetainedTasks = options.maxRetainedTasks ?? 100;
    this.handleShellExec = this.handleShellExec.bind(this);
  }

  onComplete(cb: (task: BackgroundTask) => void): void {
    this.onCompleteCallback = cb;
  }

  async enqueue(command: string): Promise<BackgroundTask> {
    const task: BackgroundTask = {
      id: '',
      command,
      status: 'queued',
      progress: 'Waiting in queue...',
      createdAt: Date.now(),
    };

    try {
      await this.start();
      const id = await this.jobQueue.enqueue(
        'shell.exec',
        { command },
        { priority: 0, retries: 0 },
      );
      task.id = id;
      this.tasks.set(id, task);
      return task;
    } catch (err) {
      getLogger().error(
        'BACKGROUND_QUEUE',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  async cancel(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return false;
    }

    try {
      await this.start();
      await this.jobQueue.cancel(id);
      task.status = 'cancelled';
      task.progress = 'Cancelled by user.';
      return true;
    } catch (err) {
      getLogger().error(
        'BACKGROUND_QUEUE',
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getRunningCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'running') count++;
    }
    return count;
  }

  setResult(id: string, result: string, success: boolean): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return;
    task.status = success ? 'completed' : 'failed';
    task.result = result;
    task.completedAt = Date.now();
    task.progress = success ? 'Completed.' : 'Failed.';
    this.onCompleteCallback?.(task);
    this.pruneFinishedTasks();
  }

  setProgress(id: string, progress: string): void {
    const task = this.tasks.get(id);
    if (task && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
      task.progress = progress;
    }
  }

  private async start(): Promise<void> {
    if (this.started) return;
    if (this.starting) return this.starting;
    this.starting = this.doStart();
    try {
      await this.starting;
      this.started = true;
    } finally {
      this.starting = null;
    }
  }

  private async doStart(): Promise<void> {
    await this.jobQueue.start();
    this.jobQueue.registerWorker('shell.exec', this.handleShellExec);
  }

  private async handleShellExec(data: unknown, ctx: JobContext): Promise<void> {
    const { command } = data as { command?: string };
    if (!command || typeof command !== 'string') {
      this.setResult(ctx.id, 'Invalid command', false);
      throw new Error('Invalid command');
    }

    const task = this.tasks.get(ctx.id);
    if (task?.status === 'cancelled') return;
    if (task) {
      task.status = 'running';
      task.progress = 'Running...';
    }

    const exec = promisify(execCallback);
    try {
      const { stdout, stderr } = await exec(command, {
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
        signal: ctx.signal,
      });
      const output = stdout + (stderr ? `\n${stderr}` : '');
      if (this.tasks.get(ctx.id)?.status === 'cancelled') return;
      this.setResult(ctx.id, output, true);
      return;
    } catch (err) {
      if (this.tasks.get(ctx.id)?.status === 'cancelled') return;
      const stdout = (err as ExecError).stdout ?? '';
      const stderr = (err as ExecError).stderr ?? '';
      const message = err instanceof Error ? err.message : String(err);
      const output = [stdout, stderr, message].filter(Boolean).join('\n');
      this.setResult(ctx.id, output, false);
      throw new Error(output);
    }
  }

  private pruneFinishedTasks(): void {
    const finished = Array.from(this.tasks.values())
      .filter((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt));
    if (finished.length <= this.maxRetainedTasks) return;
    for (const task of finished.slice(this.maxRetainedTasks)) {
      this.tasks.delete(task.id);
    }
  }
}
