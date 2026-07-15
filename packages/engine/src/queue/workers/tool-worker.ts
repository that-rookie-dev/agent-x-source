import { getLogger } from '@agentx/shared';
import { JOB_NAMES } from '../job-names.js';
import type { IJobQueue, JobHandler, JobContext } from '../IJobQueue.js';
import type { ToolService } from '../../services/tool/ToolService.js';

export interface ToolJobData {
  toolId: string;
  args: Record<string, unknown>;
  sessionId?: string;
}

export function createToolWorker(toolService: ToolService): JobHandler {
  return async (data: unknown, ctx: JobContext): Promise<void> => {
    if (typeof data !== 'object' || !data || !('toolId' in data)) {
      getLogger().warn('TOOL_WORKER', 'Invalid tool job payload', { id: ctx.id, data });
      return;
    }

    const { toolId, args = {}, sessionId = ctx.id } = data as ToolJobData;

    try {
      await toolService.execute(toolId, args, sessionId, ctx);
    } catch (err) {
      getLogger().error(
        'TOOL_WORKER',
        `Execution failed for ${toolId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  };
}

export function registerToolWorkers(queue: IJobQueue, toolService: ToolService): void {
  queue.registerWorker(JOB_NAMES.TOOL_EXEC, createToolWorker(toolService));
}
