import {
  KnowledgeBaseService,
  setKnowledgeBaseService,
} from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine, awaitEngineStorageReady } from '../engine.js';
import { getFabric } from '../memory/shared.js';
import {
  broadcastKnowledgeBaseSourceFailed,
  broadcastKnowledgeBaseSourceReady,
  broadcastKnowledgeBaseSourceStatus,
} from '../ws.js';

let service: KnowledgeBaseService | null = null;
let bootstrapPromise: Promise<KnowledgeBaseService | null> | null = null;

function wireStatusBroadcasts(svc: KnowledgeBaseService): void {
  svc.onStatusChange((sourceId, status, progress, detail, error) => {
    if (status === 'ready') {
      broadcastKnowledgeBaseSourceReady({ sourceId });
      return;
    }
    if (status === 'failed') {
      broadcastKnowledgeBaseSourceFailed({ sourceId, error: error ?? 'failed' });
      return;
    }
    broadcastKnowledgeBaseSourceStatus({
      sourceId,
      status,
      progress,
      detail,
      error,
    });
  });
}

export async function getKnowledgeBaseService(): Promise<KnowledgeBaseService | null> {
  if (service) return service;
  if (bootstrapPromise) return bootstrapPromise;

  await awaitEngineStorageReady();
  const pool = getEngine().pgPool;
  const fabric = getFabric();
  if (!pool || !fabric) {
    return null;
  }

  const svc = new KnowledgeBaseService({ pool, fabric });
  bootstrapPromise = Promise.resolve()
    .then(() => {
      wireStatusBroadcasts(svc);
      service = svc;
      setKnowledgeBaseService(svc);
      getLogger().info('KNOWLEDGE_BASE', 'Knowledge base service bootstrapped (Neural Cortex backend)');
      return svc;
    })
    .catch((err) => {
      getLogger().error(
        'KNOWLEDGE_BASE',
        `Failed to bootstrap: ${err instanceof Error ? err.message : String(err)}`,
      );
      bootstrapPromise = null;
      return null;
    });
  return bootstrapPromise;
}
