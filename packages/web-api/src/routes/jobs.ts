import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApiContext } from '../services/ApiService.js';

export function router(ctx: ApiContext): Router {
  const api = ctx.api;
  const r: Router = Router();

  r.post('/', async (req: Request, res: Response) => {
    const { name, data, opts } = req.body as {
      name?: string;
      data?: unknown;
      opts?: { delay?: number; retries?: number; priority?: number };
    };
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const id = await api.getJobQueue().enqueue(name, data ?? {}, opts);
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.get('/:id', async (req: Request, res: Response) => {
    const id = req.params['id'];
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    try {
      const job = await api.getJobQueue().getJob(id);
      if (!job) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json({ job });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params['id'];
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    try {
      const cancelled = await api.getJobQueue().cancel(id);
      res.json({ cancelled });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return r;
}
