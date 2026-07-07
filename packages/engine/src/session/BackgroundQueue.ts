import { randomUUID } from 'node:crypto';

export interface BackgroundTask {
  id: string;
  command: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: string;
  result?: string;
  createdAt: number;
  completedAt?: number;
}

export class BackgroundQueue {
  private tasks: Map<string, BackgroundTask> = new Map();
  private queue: string[] = [];
  private maxConcurrent: number;
  private readonly maxRetainedTasks: number;
  private onCompleteCallback: ((task: BackgroundTask) => void) | null = null;

  constructor(maxConcurrent = 2, maxRetainedTasks = 100) {
    this.maxConcurrent = maxConcurrent;
    this.maxRetainedTasks = maxRetainedTasks;
  }

  onComplete(cb: (task: BackgroundTask) => void): void {
    this.onCompleteCallback = cb;
  }

  enqueue(command: string): BackgroundTask {
    const id = randomUUID();
    const task: BackgroundTask = {
      id,
      command,
      status: 'queued',
      progress: 'Waiting in queue...',
      createdAt: Date.now(),
    };
    this.tasks.set(id, task);
    this.queue.push(id);
    this.processQueue();
    return task;
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === 'queued') {
      task.status = 'cancelled';
      this.queue = this.queue.filter((qid) => qid !== id);
      return true;
    }
    if (task.status === 'running') {
      task.status = 'cancelled';
      task.progress = 'Cancelled by user.';
      return true;
    }
    return false;
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
    task.status = success ? 'completed' : 'failed';
    task.result = result;
    task.completedAt = Date.now();
    task.progress = success ? 'Completed.' : 'Failed.';
    this.onCompleteCallback?.(task);
    this.pruneFinishedTasks();
    this.processQueue();
  }

  setProgress(id: string, progress: string): void {
    const task = this.tasks.get(id);
    if (task) task.progress = progress;
  }

  runTask(id: string, executor: (task: BackgroundTask) => Promise<boolean>): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'running';
    task.progress = 'Running...';
    executor(task).then((success) => {
      if (task.status !== 'cancelled') {
        if (!task.result) {
          task.result = success ? 'Completed successfully.' : 'Task failed.';
        }
        task.status = success ? 'completed' : 'failed';
        task.completedAt = Date.now();
        task.progress = success ? 'Completed.' : 'Failed.';
        this.onCompleteCallback?.(task);
      }
      this.pruneFinishedTasks();
      this.processQueue();
    });
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

  private processQueue(): void {
    while (this.getRunningCount() < this.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) break;
      const task = this.tasks.get(id);
      if (!task || task.status === 'cancelled') continue;
      this.runTask(id, async (t) => {
        try {
          const { execSync } = await import('node:child_process');
          const output = execSync(t.command, {
            encoding: 'utf-8',
            timeout: 300000,
            maxBuffer: 10 * 1024 * 1024,
          });
          t.result = output;
          return true;
        } catch (err) {
          t.result = (err as Error).message;
          return false;
        }
      });
    }
  }
}
