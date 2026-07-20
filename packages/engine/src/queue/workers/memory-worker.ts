import { getLogger } from '@agentx/shared';
import { JOB_NAMES } from '../job-names.js';
import type { IJobQueue, JobHandler, JobContext } from '../IJobQueue.js';
import type { MemoryService } from '../../services/memory/MemoryService.js';
import type { DocumentIngestInput } from '../../neural/DocumentIngester.js';

export interface RagIngestJobData extends DocumentIngestInput {
  sessionId?: string;
  agentId?: string;
}

export interface MemoryExtractJobData {
  text: string;
  label?: string;
  sessionId?: string;
  agentId?: string;
  category?: import('../../neural/MemoryFabric.js').MemoryNodeCategory;
  extract?: boolean;
  embed?: boolean;
}

export function createMemoryWorker(memoryService: MemoryService): JobHandler {
  return async (data: unknown, ctx: JobContext): Promise<void> => {
    if (typeof data !== 'object' || !data) {
      getLogger().warn('MEMORY_WORKER', 'Invalid memory job payload', { id: ctx.id, data });
      return;
    }

    if ('content' in data && 'name' in data) {
      const ragData = data as RagIngestJobData;
      try {
        await memoryService.ingestDocument(ragData);
      } catch (err) {
        getLogger().error(
          'MEMORY_WORKER',
          `RAG ingest failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
      return;
    }

    if ('text' in data) {
      const extractData = data as MemoryExtractJobData;
      try {
        await memoryService.ingest({
          text: extractData.text,
          label: extractData.label,
          sessionId: extractData.sessionId,
          agentId: extractData.agentId,
          category: extractData.category ?? 'semantic',
          extract: extractData.extract ?? true,
          embed: extractData.embed ?? true,
        });
      } catch (err) {
        getLogger().error(
          'MEMORY_WORKER',
          `Memory extract failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
      return;
    }

    getLogger().warn('MEMORY_WORKER', 'Unrecognized memory job payload', { id: ctx.id, data });
  };
}

export function registerMemoryWorkers(queue: IJobQueue, memoryService: MemoryService): void {
  queue.registerWorker(JOB_NAMES.RAG_INGEST, createMemoryWorker(memoryService));
  queue.registerWorker(JOB_NAMES.MEMORY_EXTRACT, createMemoryWorker(memoryService));
}
