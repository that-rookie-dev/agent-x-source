import type { Express, Request, Response } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine, awaitStorageForApi } from './engine.js';
import { MarkdownDocumentStore } from '@agentx/engine';
import { validate, createMarkdownDocumentSchema } from './validation.js';
import { broadcast } from './ws.js';

export function registerMarkdownRoutes(app: Express): void {
  app.get('/api/markdown', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.json({ documents: [] });
        return;
      }
      const store = new MarkdownDocumentStore(eng.pgPool);
      const sessionId = typeof req.query['session_id'] === 'string' ? req.query['session_id'] : undefined;
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 200);
      const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0);
      const documents = sessionId
        ? await store.listForSession(sessionId, limit)
        : await store.list(limit, offset);
      res.json({ documents });
    } catch (e) {
      getLogger().error('GET_API_MARKDOWN', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  app.get('/api/markdown/:id', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const store = new MarkdownDocumentStore(eng.pgPool);
      const payload = await store.getContent(req.params['id']!);
      if (!payload) {
        res.status(404).json({ error: 'markdown-not-found' });
        return;
      }
      res.json({
        document: payload.record,
        contentMarkdown: payload.contentMarkdown,
      });
    } catch (e) {
      getLogger().error('GET_API_MARKDOWN_ID', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'get-failed' });
    }
  });

  app.post('/api/markdown', validate(createMarkdownDocumentSchema), async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const body = req.body as {
        sessionId: string;
        title?: string;
        contentMarkdown?: string;
        contentTsx?: string;
        messageId?: string;
        sourceRole?: 'user' | 'assistant' | 'system';
      };
      const store = new MarkdownDocumentStore(eng.pgPool);
      const record = await store.create({
        sessionId: body.sessionId,
        title: body.title ?? '',
        contentMarkdown: body.contentMarkdown,
        contentTsx: body.contentTsx,
        messageId: body.messageId,
        sourceRole: body.sourceRole,
      });
      broadcast({ type: 'markdown_created', document: record });
      res.status(201).json({ document: record });
    } catch (e) {
      getLogger().error('POST_API_MARKDOWN', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'create-failed' });
    }
  });

  app.delete('/api/markdown/:id', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const store = new MarkdownDocumentStore(eng.pgPool);
      const ok = await store.delete(req.params['id']!);
      res.json({ ok });
    } catch (e) {
      getLogger().error('DELETE_API_MARKDOWN_ID', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });
}
