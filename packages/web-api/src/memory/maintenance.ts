/**
 * Memory maintenance route group.
 *
 * Extracted from memory-api.ts. Handles web staging, system-init,
 * storage status, cleanup, re-embedding, parity tests, and offline verification.
 */
import { Router, type Request, type Response } from 'express';
import { getLogger } from '@agentx/shared';
import { broadcastBrainActivity } from '../ws.js';
import { getFabric, handleFabricUnavailable } from './shared.js';

const logger = getLogger();

export function createMaintenanceRouter(): Router {
  const r = Router();

  r.post('/memory/web-stage', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const { url, domain, kind, rawPayload, sourceId } = req.body as Record<string, unknown>;
      if (typeof url !== 'string' || typeof domain !== 'string') {
        return res.status(400).json({ error: 'url and domain are required' });
      }
      const id = await fabric.stageWebPayload(url, domain, kind as string || 'raw', rawPayload, sourceId as string | undefined);
      res.json({ id });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to stage web payload' });
    }
  });

  r.post('/memory/system-init', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const result = await fabric.seedSystemInitNode();
      res.json({ ok: true, nodeId: result.nodeId, created: result.created });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to create system-init node' });
    }
  });

  r.get('/memory/storage-status', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const { MemoryMigrationRunner } = await import('@agentx/engine');
      const runner = new MemoryMigrationRunner(fabric['pool']);
      const { applied, currentVersion } = await fabric.migrate();
      const { available: ageAvailable, error: ageError } = await runner.detectAge();
      res.json({
        postgres: true,
        schemaVersion: currentVersion,
        migrationsApplied: applied,
        age: { available: ageAvailable, error: ageError ?? null },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get storage status' });
    }
  });

  r.post('/memory/cleanup-dividers', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const dryRun = req.body?.dryRun === true;
      const result = await fabric.cleanupDividerNodes(dryRun);
      if (!dryRun && result.deletedNodes > 0) {
        broadcastBrainActivity({
          type: 'cluster_layout_updated',
          epoch: 0,
          count: -result.deletedNodes,
          timestamp: new Date().toISOString(),
        });
      }
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to cleanup divider nodes' });
    }
  });

  r.post('/memory/re-embed', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const { OnnxEmbeddingProvider } = await import('@agentx/engine');
      const embedder = new OnnxEmbeddingProvider();
      const result = await fabric.reEmbedAll(embedder);
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to re-embed memory' });
    }
  });

  r.post('/memory/parity-test', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const { startNodeIds, maxDepth, maxFanOut, minWeight, relationshipTypes } = req.body as Record<string, unknown>;
      if (!Array.isArray(startNodeIds) || startNodeIds.length === 0) {
        return res.status(400).json({ error: 'startNodeIds array is required' });
      }
      const result = await fabric.runGraphWalkParityTest({
        startNodeIds: startNodeIds as string[],
        maxDepth: typeof maxDepth === 'number' ? maxDepth : 2,
        maxFanOut: typeof maxFanOut === 'number' ? maxFanOut : 10,
        minWeight: typeof minWeight === 'number' ? minWeight : 0.1,
        relationshipTypes: Array.isArray(relationshipTypes) ? (relationshipTypes as ('CONTAINS' | 'REFERENCES' | 'NEXT_STEP' | 'REQUIRES' | 'RELATED_TO' | 'GENERATED_OUTPUT' | 'USING_TOOL' | 'SHARED_INSIGHT')[]) : undefined,
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to run parity test' });
    }
  });

  r.post('/memory/verify-offline', async (_req: Request, res: Response) => {
    try {
      const { verifyOfflineMode } = await import('@agentx/engine');
      const result = await verifyOfflineMode();
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to verify offline mode' });
    }
  });

  return r;
}
