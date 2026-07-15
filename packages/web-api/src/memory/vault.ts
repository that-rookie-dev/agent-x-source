/**
 * Memory vault route group.
 *
 * Extracted from memory-api.ts. Handles vault restore, purge, and list.
 */
import { Router, type Request, type Response } from 'express';
import { getLogger } from '@agentx/shared';
import { getFabric, handleFabricUnavailable } from './shared.js';

const logger = getLogger();

export function createVaultRouter(): Router {
  const r = Router();

  r.post('/memory/vault/restore', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    const { token } = req.body as Record<string, unknown>;
    if (typeof token !== 'string') return res.status(400).json({ error: 'token is required' });
    try {
      const value = await fabric.vaultRestore(token);
      res.json({ token, value });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to restore vault token' });
    }
  });

  r.post('/memory/vault/purge', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const count = await fabric.vaultPurge(req.body.kind as string | undefined);
      res.json({ deleted: count });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to purge vault' });
    }
  });

  r.get('/memory/vault/list', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const entries = await fabric.vaultList({
        kind: (req.query.kind as string) || undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      });
      res.json({ entries });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to list vault' });
    }
  });

  return r;
}
