/**
 * Memory sources route group.
 *
 * Handles source listing, node browsing, optional original-file download,
 * and source creation for the neural memory fabric (Agent + web-neuron).
 */
import { Router, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { MemoryNodeCategory } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { validate, memorySourceCreateSchema } from '../validation.js';
import { getFabric, handleFabricUnavailable } from './shared.js';

const logger = getLogger();

export function createSourcesRouter(): Router {
  const r = Router();

  r.get('/memory/sources', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const sources = await fabric.getSources();
      res.json(sources);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to list memory sources' });
    }
  });

  /**
   * GET /memory/sources/:id/nodes  — browse all knowledge entries belonging to a source.
   */
  r.get('/memory/sources/:id/nodes', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const category = (req.query.category as string) || undefined;
      const result = await fabric.getNodesBySource(req.params['id']!, {
        limit: Number.isNaN(limit) ? 100 : limit,
        offset: Number.isNaN(offset) ? 0 : offset,
        category: category as MemoryNodeCategory,
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to list source nodes' });
    }
  });

  /**
   * GET /memory/sources/:id/file  — download the original file for a source (if any).
   */
  r.get('/memory/sources/:id/file', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const sources = await fabric.getSources();
      const source = sources.find((s) => s.id === req.params['id']);
      if (!source) return res.status(404).json({ error: 'Source not found' });
      if (!source.filePath || !existsSync(source.filePath)) {
        return res.status(404).json({ error: 'No file associated with this source' });
      }
      const st = await stat(source.filePath);
      const filename = source.name || basename(source.filePath);
      res.setHeader('Content-Type', source.fileMime ?? 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const { createReadStream } = await import('node:fs');
      createReadStream(source.filePath).pipe(res);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to download source file' });
    }
  });

  r.post('/memory/sources', validate(memorySourceCreateSchema), async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const source = await fabric.createSource(req.body.name, req.body.kind, req.body.colorHex);
      res.json(source);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to create memory source' });
    }
  });

  return r;
}
