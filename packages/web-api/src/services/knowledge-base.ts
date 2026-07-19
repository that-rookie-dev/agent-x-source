import { KnowledgeBaseManager, setKnowledgeBaseManager } from '@agentx/engine';
import { getDataDir, getLogger } from '@agentx/shared';
import { getEngine, awaitEngineStorageReady } from '../engine.js';
import {
  broadcastKnowledgeSourceFailed,
  broadcastKnowledgeSourceReady,
  broadcastKnowledgeSourceStatus,
} from '../ws.js';

let manager: KnowledgeBaseManager | null = null;
let bootstrapPromise: Promise<KnowledgeBaseManager | null> | null = null;

function wireStatusBroadcasts(m: KnowledgeBaseManager): void {
  m.onStatusChange((sourceId, status, progress, detail, error) => {
    if (status === 'ready') {
      broadcastKnowledgeSourceReady({ sourceId });
      return;
    }
    if (status === 'failed') {
      broadcastKnowledgeSourceFailed({ sourceId, error: error ?? 'failed' });
      return;
    }
    broadcastKnowledgeSourceStatus({
      sourceId,
      status,
      progress,
      detail,
      error,
    });
  });
}

export async function getKnowledgeBaseManager(): Promise<KnowledgeBaseManager | null> {
  if (manager) return manager;
  if (bootstrapPromise) return bootstrapPromise;

  await awaitEngineStorageReady();
  const pool = getEngine().pgPool;
  if (!pool) {
    return null;
  }

  const m = new KnowledgeBaseManager({ pool, dataDir: getDataDir() });
  bootstrapPromise = m
    .bootstrap()
    .then(() => {
      wireStatusBroadcasts(m);
      manager = m;
      setKnowledgeBaseManager(m);
      getLogger().info('KNOWLEDGE_BASE', 'Knowledge base manager bootstrapped');
      return m;
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
