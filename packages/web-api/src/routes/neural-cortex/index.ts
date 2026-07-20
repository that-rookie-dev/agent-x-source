/**
 * Neural Cortex API — engine routes (embeddings, storage, source browse).
 */
import { Router, type Request, type Response } from 'express';
import type { MemoryNodeCategory } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getFabric, handleFabricUnavailable } from '../../memory/shared.js';
import embeddingRouter from '../../embedding-model-api.js';
import { cortexGraphRouter } from './graph.js';

const logger = getLogger();

export function neuralCortexRouter(): Router {
  const r = Router();

  r.use(embeddingRouter);
  r.use(cortexGraphRouter());

  r.get('/neural-cortex/storage-status', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const { applied, currentVersion } = await fabric.migrate();
      res.json({
        postgres: true,
        schemaVersion: currentVersion,
        migrationsApplied: applied,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.error('NEURAL_CORTEX', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get storage status' });
    }
  });

  r.post('/neural-cortex/system-init', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const { created, nodeId } = await fabric.seedSystemInitNode();
      res.json({ ok: true, created, nodeId });
    } catch (e) {
      logger.error('NEURAL_CORTEX', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to seed system init node' });
    }
  });

  r.get('/neural-cortex/sources/:id/nodes', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
      const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
      const category = typeof req.query.category === 'string'
        ? req.query.category as MemoryNodeCategory
        : undefined;
      const result = await fabric.getNodesBySource(req.params.id, { limit, offset, category });
      res.json(result);
    } catch (e) {
      logger.error('NEURAL_CORTEX', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to list source nodes' });
    }
  });

  return r;
}
