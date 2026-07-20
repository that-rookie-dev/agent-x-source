import { getLogger } from '@agentx/shared';
import type { IJobQueue, JobHandler, JobContext } from '../IJobQueue.js';
import { JOB_NAMES } from '../job-names.js';

export type JobWorker = JobHandler;

export { createToolWorker, registerToolWorkers } from './tool-worker.js';
export { createMemoryWorker, registerMemoryWorkers } from './memory-worker.js';

/**
 * Register no-op handlers for all durable job names.
 *
 * Shell/exec is excluded because BackgroundQueue registers its own
 * shell.exec worker; registering a no-op would override it on the queue.
 */
export function registerNoOpJobWorkers(queue: IJobQueue): void {
  for (const name of Object.values(JOB_NAMES)) {
    if (name === JOB_NAMES.SHELL_EXEC) continue;

    queue.registerWorker(name, async (data: unknown, ctx: JobContext) => {
      getLogger().info('JOB_WORKER', `No-op worker for ${name}`, {
        id: ctx.id,
        attempt: ctx.attempt,
        data,
      });
    });
  }
}
