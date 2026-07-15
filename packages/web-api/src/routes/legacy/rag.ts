import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';

export function createRagRouter(): Router {
  const r = Router();

  r.get('/api/rag/status', (_req, res) => {
    const eng = getEngine();
    if (!eng.rag) {
      res.json({ enabled: false, indexedChunks: 0 });
      return;
    }
    eng.rag.chunkCount().then((count) => {
      res.json({ enabled: true, indexedChunks: count });
    }).catch(() => {
      res.json({ enabled: true, indexedChunks: 0 });
    });
  });

  r.post('/api/rag/index', async (req, res) => {
    const eng = getEngine();
    if (!eng.rag) {
      res.status(400).json({ error: 'RAG is not enabled' });
      return;
    }
    const { content, metadata, id } = req.body as { content?: string; metadata?: Record<string, unknown>; id?: string };
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    try {
      const docId = await eng.rag.indexDocument({ id, content, metadata });
      res.json({ docId });
    } catch (e: unknown) {
      getLogger().error('POST_API_RAG_INDEX', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'index-failed' });
    }
  });

  r.post('/api/rag/search', async (req, res) => {
    const eng = getEngine();
    if (!eng.rag) {
      res.status(400).json({ error: 'RAG is not enabled' });
      return;
    }
    const { query, topK } = req.body as { query?: string; topK?: number };
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    try {
      const results = await eng.rag.search(query, topK);
      res.json({ results });
    } catch (e: unknown) {
      getLogger().error('POST_API_RAG_SEARCH', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'search-failed' });
    }
  });

  r.delete('/api/rag/documents/:id', async (req, res) => {
    const eng = getEngine();
    if (!eng.rag) {
      res.status(400).json({ error: 'RAG is not enabled' });
      return;
    }
    try {
      await eng.rag.deleteDocument(req.params['id']!);
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('DELETE_API_RAG_DOCUMENTS_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });

  r.post('/api/rag/clear', async (_req, res) => {
    const eng = getEngine();
    if (!eng.rag) {
      res.status(400).json({ error: 'RAG is not enabled' });
      return;
    }
    try {
      await eng.rag.clearAll();
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_RAG_CLEAR', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-failed' });
    }
  });

  return r;
}
