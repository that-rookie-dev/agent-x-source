/**
 * Module-level reference to the ingestion worker.
 *
 * Kept in a separate module to avoid circular imports between index.ts and auth.ts.
 * The ingestion worker's LLM generator can only be built after the user logs in
 * (the config is encrypted and the DEK is derived from the password). This module
 * allows auth.ts to trigger a generator rebuild after login without importing
 * from index.ts.
 */
import type { IngestionWorker } from '@agentx/engine';
import { MemoryFabric, IngestionQueue } from '@agentx/engine';
import { buildGraphRagSummarizer } from './distillation-generator.js';
import { getEngine } from './engine.js';
import { getLogger } from '@agentx/shared';

let _worker: IngestionWorker | null = null;

/** Store a reference to the active ingestion worker. Called once at startup. */
export function setIngestionWorkerRef(worker: IngestionWorker | null): void {
  _worker = worker;
}

/** Get the active ingestion worker (for cancellation requests). */
export function getIngestionWorker(): IngestionWorker | null {
  return _worker;
}

/**
 * Rebuild the GraphRAG summarizer generator and update the ingestion worker.
 * Called after user login when the DEK becomes available, allowing the worker
 * to read the encrypted config and build the LLM generator.
 */
export async function refreshIngestionWorkerGenerator(): Promise<void> {
  if (!_worker) return;
  try {
    const graphRagGenerate = await buildGraphRagSummarizer();
    _worker.setGenerate(graphRagGenerate);
    if (graphRagGenerate) {
      getLogger().info('INGESTION_WORKER', 'GraphRAG summarizer generator built successfully after login');
      // Auto-enqueue re_extract jobs for sources that were ingested without
      // an LLM generator (e.g. before login). These sources have chunk nodes
      // but no semantic entity nodes.
      void enqueueReExtractionJobs();
    }
  } catch (e) {
    getLogger().warn('INGESTION_WORKER', `Failed to rebuild GraphRAG generator after login: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Find all sources that have chunk nodes but no semantic entities, and enqueue
 * re_extract jobs so the worker can run entity extraction on them now that the
 * LLM generator is available.
 */
async function enqueueReExtractionJobs(): Promise<void> {
  try {
    const pool = getEngine().pgPool;
    if (!pool) return;
    const fabric = new MemoryFabric(pool);
    const queue = new IngestionQueue(pool);

    // Get all sources.
    const sources = await fabric.getSources();
    let enqueued = 0;
    for (const source of sources) {
      // Check if this source already has semantic entities.
      const { nodes: existingSemantic } = await fabric.getNodesBySource(source.id, { category: 'semantic', limit: 1 });
      if (existingSemantic.length > 0) continue; // already has entities

      // Check if it has chunk nodes (i.e. ingestion happened).
      const { nodes: chunks } = await fabric.getNodesBySource(source.id, { category: 'source_doc', limit: 1 });
      if (chunks.length === 0) continue; // no chunks to extract from

      // Check if a re_extract job is already queued/active for this source.
      const hasActive = await queue.hasActiveJob('re_extract').catch(() => false);
      if (hasActive) continue;

      await queue.enqueue({
        kind: 're_extract',
        payload: { sourceId: source.id },
        priority: 2, // higher than periodic jobs so it runs first
      });
      enqueued++;
    }
    if (enqueued > 0) {
      getLogger().info('INGESTION_WORKER', `Auto-enqueued ${enqueued} re_extract job(s) for sources missing entity extraction`);
    }
  } catch (e) {
    getLogger().warn('INGESTION_WORKER', `Failed to enqueue re_extract jobs: ${e instanceof Error ? e.message : String(e)}`);
  }
}
