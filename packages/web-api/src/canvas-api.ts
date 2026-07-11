import type { Express, Request, Response } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine } from './engine.js';
import { CanvasStore } from '@agentx/engine';
import { validate, createCanvasSchema } from './validation.js';
import { broadcast } from './ws.js';

export function registerCanvasRoutes(app: Express): void {
  app.get('/api/canvases', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await eng.storageReady;
      if (!eng.pgPool) {
        res.json({ canvases: [] });
        return;
      }
      const store = new CanvasStore(eng.pgPool);
      const sessionId = typeof req.query['session_id'] === 'string' ? req.query['session_id'] : undefined;
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 200);
      const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0);
      const canvases = sessionId
        ? await store.listForSession(sessionId, limit)
        : await store.list(limit, offset);
      res.json({ canvases });
    } catch (e) {
      getLogger().error('GET_API_CANVASES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  app.get('/api/canvases/:id', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await eng.storageReady;
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const store = new CanvasStore(eng.pgPool);
      const payload = await store.getContent(req.params['id']!);
      if (!payload) {
        res.status(404).json({ error: 'canvas-not-found' });
        return;
      }
      res.json({
        canvas: payload.record,
        contentMarkdown: payload.contentMarkdown,
        contentTsx: payload.contentTsx,
        compiledJs: payload.compiledJs,
        compileError: payload.compileError ?? payload.record.compileError,
      });
    } catch (e) {
      getLogger().error('GET_API_CANVAS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'get-failed' });
    }
  });

  app.get('/api/canvases/:id/compiled.js', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await eng.storageReady;
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const store = new CanvasStore(eng.pgPool);
      const js = await store.getCompiledJs(req.params['id']!);
      if (!js) {
        res.status(404).json({ error: 'compiled-not-found' });
        return;
      }
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(js);
    } catch (e) {
      getLogger().error('GET_API_CANVAS_COMPILED', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'compiled-failed' });
    }
  });

  app.post('/api/canvases', validate(createCanvasSchema), async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await eng.storageReady;
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const body = req.body as {
        sessionId: string;
        title?: string;
        contentMarkdown?: string;
        contentTsx?: string;
        contentFormat?: 'markdown' | 'canvas_tsx';
        messageId?: string;
        sourceRole?: 'user' | 'assistant' | 'system';
      };
      const store = new CanvasStore(eng.pgPool);
      const record = await store.create({
        sessionId: body.sessionId,
        title: body.title ?? '',
        contentMarkdown: body.contentMarkdown,
        contentTsx: body.contentTsx,
        contentFormat: body.contentFormat,
        messageId: body.messageId,
        sourceRole: body.sourceRole,
      });
      broadcast({ type: 'canvas_created', canvas: record });
      res.status(201).json({ canvas: record });
    } catch (e) {
      getLogger().error('POST_API_CANVASES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'create-failed' });
    }
  });

  app.delete('/api/canvases/:id', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await eng.storageReady;
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const store = new CanvasStore(eng.pgPool);
      const ok = await store.delete(req.params['id']!);
      res.json({ ok });
    } catch (e) {
      getLogger().error('DELETE_API_CANVAS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });
}
