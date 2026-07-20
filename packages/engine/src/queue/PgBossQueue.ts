import PgBoss from 'pg-boss';
import { getLogger } from '@agentx/shared';
import type { IJobQueue, IJob, JobEnqueueOptions, JobContext, JobHandler } from './IJobQueue.js';

export interface PgBossQueueOptions {
  connectionString: string;
  pgBossOptions?: Partial<PgBoss.ConstructorOptions>;
}

export class PgBossQueue implements IJobQueue {
  private connectionString: string;
  private pgBossOptions: Partial<PgBoss.ConstructorOptions>;
  private boss: PgBoss | null = null;
  private started = false;
  private stopping = false;
  private startingPromise: Promise<void> | null = null;
  private handlers = new Map<string, JobHandler>();
  private workerIds = new Map<string, string>();
  private jobs = new Map<string, IJob>();
  private activeControllers = new Map<string, AbortController>();

  constructor({ connectionString, pgBossOptions = {} }: PgBossQueueOptions) {
    this.connectionString = connectionString;
    this.pgBossOptions = pgBossOptions;
  }

  static async migrate(connectionString: string): Promise<void> {
    const boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      migrate: true,
      supervise: false,
      schedule: false,
    });
    try {
      await boss.start();
    } finally {
      await boss.stop({ graceful: true, timeout: 5000 }).catch(() => {});
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.startingPromise) return this.startingPromise;
    this.startingPromise = this.doStart();
    try {
      await this.startingPromise;
    } finally {
      this.startingPromise = null;
    }
  }

  private async doStart(): Promise<void> {
    this.stopping = false;
    this.boss = new PgBoss({
      connectionString: this.connectionString,
      schema: 'pgboss',
      ...this.pgBossOptions,
      migrate: true,
      supervise: true,
      schedule: false,
    });
    this.boss.on('error', (err) => {
      getLogger().error('PGBOSS', err instanceof Error ? err.message : String(err));
    });
    await this.boss.start();
    this.started = true;
    for (const [name, handler] of this.handlers) {
      await this.attachWorker(name, handler);
    }
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    this.stopping = true;
    for (const controller of this.activeControllers.values()) {
      controller.abort();
    }
    this.activeControllers.clear();
    try {
      await this.boss.stop({ graceful: true, timeout: 10000 });
    } catch (err) {
      getLogger().warn('PGBOSS', err instanceof Error ? err.message : String(err));
    } finally {
      this.boss = null;
      this.started = false;
      this.stopping = false;
    }
  }

  registerWorker(name: string, handler: JobHandler): void {
    if (this.started && this.boss) {
      const existingId = this.workerIds.get(name);
      if (existingId) {
        void this.boss.offWork({ id: existingId }).catch(() => {});
      }
      void this.attachWorker(name, handler);
    }
    this.handlers.set(name, handler);
  }

  private async attachWorker(name: string, handler: JobHandler): Promise<void> {
    if (!this.boss) return;
    try {
      const workerId = await this.boss.work(
        name,
        { batchSize: 1, includeMetadata: true },
        async (jobs: PgBoss.JobWithMetadata<unknown>[]) => {
          for (const job of jobs) {
            await this.runJob(job, handler);
          }
        },
      );
      this.workerIds.set(name, workerId);
    } catch (err) {
      getLogger().error('PGBOSS', err instanceof Error ? err.message : String(err));
    }
  }

  private async runJob(liveJob: PgBoss.JobWithMetadata<unknown>, handler: JobHandler): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(liveJob.id, controller);
    try {
      const ctx: JobContext = {
        id: liveJob.id,
        name: liveJob.name,
        attempt: (liveJob.retryCount ?? 0) + 1,
        signal: controller.signal,
      };
      await handler(liveJob.data, ctx);
    } catch (err) {
      if (controller.signal.aborted || this.stopping) {
        return;
      }
      throw err;
    } finally {
      this.activeControllers.delete(liveJob.id);
    }
  }

  async enqueue<T = unknown>(name: string, data: T, opts?: JobEnqueueOptions): Promise<string> {
    await this.start();
    const sendData = data && typeof data === 'object' ? data : { payload: data };
    const sendOpts = this.toSendOptions(opts);
    const id = await this.boss!.send(name, sendData as object, sendOpts);
    if (!id) throw new Error('pg-boss send failed');
    this.jobs.set(id, {
      id,
      name,
      data,
      status: 'queued',
      createdAt: Date.now(),
      attempt: 1,
    });
    return id;
  }

  private toSendOptions(opts?: JobEnqueueOptions): PgBoss.SendOptions {
    const sendOpts: PgBoss.SendOptions = {};
    if (opts?.delay && opts.delay > 0) {
      sendOpts.startAfter = new Date(Date.now() + opts.delay);
    }
    if (opts?.retries !== undefined) {
      sendOpts.retryLimit = opts.retries;
    }
    if (opts?.priority !== undefined) {
      sendOpts.priority = opts.priority;
    }
    return sendOpts;
  }

  async getJob(id: string): Promise<IJob | undefined> {
    await this.start();
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const live = await this.boss!.getJobById<unknown>(job.name, id, { includeArchive: true });
    if (!live) return job;
    if (job.status === 'cancelled' && live.state === 'failed') return job;
    return this.mapJob(live);
  }

  getQueueDepth(): number {
    return this.activeControllers.size;
  }

  async cancel(id: string): Promise<boolean> {
    await this.start();
    const job = this.jobs.get(id);
    if (!job) return false;
    const controller = this.activeControllers.get(id);
    if (controller) controller.abort();
    if (this.boss) {
      try {
        await this.boss.cancel(job.name, id);
      } catch {
        return false;
      }
    }
    this.jobs.set(id, { ...job, status: 'cancelled' });
    return true;
  }

  private mapJob(live: PgBoss.JobWithMetadata<unknown>): IJob {
    return {
      id: live.id,
      name: live.name,
      data: live.data,
      status: this.mapState(live.state),
      result: this.mapOutput(live.output),
      createdAt: live.createdOn.getTime(),
      completedAt: live.completedOn?.getTime(),
      attempt: (live.retryCount ?? 0) + 1,
    };
  }

  private mapState(state: PgBoss.JobWithMetadata['state']): IJob['status'] {
    switch (state) {
      case 'created':
      case 'retry':
        return 'queued';
      case 'active':
        return 'running';
      case 'completed':
        return 'completed';
      case 'cancelled':
        return 'cancelled';
      case 'failed':
        return 'failed';
      default:
        return 'queued';
    }
  }

  private mapOutput(output: PgBoss.JobWithMetadata['output']): string | undefined {
    if (!output || Object.keys(output).length === 0) return undefined;
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
}
