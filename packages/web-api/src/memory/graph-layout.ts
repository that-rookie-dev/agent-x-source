/**
 * Memory graph layout route group.
 *
 * Extracted from memory-api.ts. Handles Louvain layout computation,
 * layout epoch queries, and viewport-based node retrieval.
 */
import { Router, type Request, type Response } from 'express';
import type { MemoryNodeCategory } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { broadcastBrainActivity } from '../ws.js';
import { getFabric, handleFabricUnavailable } from './shared.js';

const logger = getLogger();

export function createGraphLayoutRouter(): Router {
  const r = Router();

  r.get('/memory/graph/layout', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const result = await fabric.computeLouvainLayout();
      broadcastBrainActivity({
        type: 'cluster_layout_updated',
        epoch: result.epoch,
        count: result.count,
        timestamp: new Date().toISOString(),
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to compute Louvain layout' });
    }
  });

  r.get('/memory/graph/layout-epoch', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const epoch = await fabric.getLayoutEpoch();
      res.json({ epoch });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get layout epoch' });
    }
  });

  r.get('/memory/graph/viewport', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const xMin = parseFloat(req.query.xMin as string);
      const yMin = parseFloat(req.query.yMin as string);
      const xMax = parseFloat(req.query.xMax as string);
      const yMax = parseFloat(req.query.yMax as string);
      if ([xMin, yMin, xMax, yMax].some(Number.isNaN)) {
        return res.status(400).json({ error: 'xMin, yMin, xMax, yMax are required' });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 2000;
      const zoom = req.query.zoom ? parseFloat(req.query.zoom as string) : 1;
      const category = (req.query.category as string) || undefined;
      const result = await fabric.getViewport(
        { xmin: xMin, xmax: xMax, ymin: yMin, ymax: yMax },
        {
          zoom: Number.isNaN(zoom) ? 1 : zoom,
          limit: Number.isNaN(limit) ? 2000 : limit,
          category: category as MemoryNodeCategory,
        },
      );
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get viewport nodes' });
    }
  });

  return r;
}
