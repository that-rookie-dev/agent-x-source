import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import type { KnowledgeSearchResult } from '@agentx/shared';
import { getKnowledgeBaseManager } from '../services/knowledge-base.js';
import { broadcastKnowledgeSourceStatus } from '../ws.js';
import type { ApiContext } from '../services/ApiService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  // Large multi-hundred-page PDFs routinely exceed 50MB.
  limits: { fileSize: 200 * 1024 * 1024 },
});

export function router(_ctx: ApiContext): Router {
  const r = Router();

  r.post('/knowledge/upload', upload.single('file'), async (req: Request, res: Response) => {
    const manager = await getKnowledgeBaseManager();
    if (!manager) {
      res.status(503).json({ error: 'Knowledge base unavailable' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    const sessionId =
      typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    try {
      const source = await manager.uploadSource(
        file.buffer,
        file.originalname,
        file.mimetype || 'application/octet-stream',
        sessionId,
      );
      broadcastKnowledgeSourceStatus({
        sourceId: source.id,
        status: source.status,
        progress: source.progress,
        detail: 'uploaded',
      });
      // Stage updates + ready/failed are broadcast via KnowledgeBaseManager.onStatusChange.
      void manager.processSource(source.id).catch(() => {
        /* failure already persisted + broadcast by the pipeline */
      });
      res.json({ source });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.get('/knowledge', async (req: Request, res: Response) => {
    const manager = await getKnowledgeBaseManager();
    if (!manager) {
      res.status(503).json({ error: 'Knowledge base unavailable' });
      return;
    }
    const sessionId =
      typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    try {
      const sources = await manager.listSources(sessionId);
      res.json({ sources });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.get('/knowledge/:id', async (req: Request, res: Response) => {
    const manager = await getKnowledgeBaseManager();
    if (!manager) {
      res.status(503).json({ error: 'Knowledge base unavailable' });
      return;
    }
    const id = req.params['id'];
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    try {
      const source = await manager.getSource(id);
      if (!source) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json({ source });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.delete('/knowledge/:id', async (req: Request, res: Response) => {
    const manager = await getKnowledgeBaseManager();
    if (!manager) {
      res.status(503).json({ error: 'Knowledge base unavailable' });
      return;
    }
    const id = req.params['id'];
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    try {
      await manager.deleteSource(id);
      res.sendStatus(204);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/knowledge/:id/reprocess', async (req: Request, res: Response) => {
    const manager = await getKnowledgeBaseManager();
    if (!manager) {
      res.status(503).json({ error: 'Knowledge base unavailable' });
      return;
    }
    const id = req.params['id'];
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    try {
      await manager.reprocessSource(id);
      const source = await manager.getSource(id);
      broadcastKnowledgeSourceStatus({
        sourceId: id,
        status: source?.status ?? 'pending',
        progress: source?.progress ?? 0,
        detail: 'reprocess',
      });
      res.json({ source: source ?? { id } });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/knowledge/search', async (req: Request, res: Response) => {
    const manager = await getKnowledgeBaseManager();
    if (!manager) {
      res.status(503).json({ error: 'Knowledge base unavailable' });
      return;
    }
    const body = req.body as {
      query?: unknown;
      topK?: unknown;
      kind?: unknown;
      sourceId?: unknown;
    };
    if (typeof body.query !== 'string' || !body.query.trim()) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    const rawTopK = Number(body.topK);
    const topK = Number.isNaN(rawTopK) || rawTopK <= 0 ? 5 : Math.min(rawTopK, 100);
    const kind = typeof body.kind === 'string' ? body.kind : 'all';
    const sourceId = typeof body.sourceId === 'string' ? body.sourceId : undefined;
    if (kind !== 'chunk' && kind !== 'page' && kind !== 'all') {
      res.status(400).json({ error: 'kind must be chunk, page, or all' });
      return;
    }
    try {
      // `manager.search` is already hybrid (chunks + pages + page-aware expand).
      // Calling searchPages again for kind=all produced duplicate PAGE hits —
      // one with a resolved source name and one as UNKNOWN SOURCE.
      let results: KnowledgeSearchResult[];
      if (kind === 'page') {
        results = await manager.searchPages(body.query, topK, sourceId);
      } else {
        results = await manager.search(body.query, topK, sourceId);
        if (kind === 'chunk') {
          results = results.filter((r) => r.kind === 'chunk');
        }
      }
      const seen = new Set<string>();
      results = results.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

  const VALID_PARSERS: Record<string, string> = {
    marker: 'marker-pdf',
    docling: 'docling',
  };

  function execPython(args: string[], timeoutMs = 30_000): Promise<{ code: number; out: string; err: string }> {
    return new Promise((resolve) => {
      const child = spawn(PYTHON, args, { env: process.env, timeout: timeoutMs });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
      child.on('error', (e: Error) => resolve({ code: 1, out: '', err: e.message }));
      child.on('close', (code: number | null) => resolve({ code: code ?? 1, out: out.trim(), err: err.trim() }));
    });
  }

  async function parserVersion(pkg: string): Promise<{ installed: boolean; version?: string }> {
    const res = await execPython(['-c', `import importlib.metadata; print(importlib.metadata.version('${pkg}'))`]);
    return { installed: res.code === 0, version: res.code === 0 ? res.out : undefined };
  }

  r.get('/knowledge/parsers/status', async (_req: Request, res: Response) => {
    const parsers = await Promise.all(
      Object.entries(VALID_PARSERS).map(async ([id, pkg]) => {
        const { installed, version } = await parserVersion(pkg);
        return { id, installed, version };
      }),
    );
    res.json({ parsers });
  });

  r.post('/knowledge/parsers/install', async (req: Request, res: Response) => {
    const body = req.body as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';
    const pkg = VALID_PARSERS[id];
    if (!pkg) {
      res.status(400).json({ error: 'Unknown parser. Use marker or docling.' });
      return;
    }

    const args = ['-m', 'pip', 'install', '--upgrade', pkg];
    const result = await execPython(args, 600_000);
    if (result.code !== 0) {
      res.status(500).json({ error: `Failed to install ${pkg}: ${result.err || result.out}` });
      return;
    }

    const { installed, version } = await parserVersion(pkg);
    res.json({ success: true, id, installed, version, message: `${pkg} installed${version ? ` (${version})` : ''}` });
  });

  return r;
}
