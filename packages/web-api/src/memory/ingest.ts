/**
 * Memory ingest/pipeline route group.
 *
 * Extracted from memory-api.ts. Handles web crawling, pipeline runs,
 * pruning, backup/restore, and file/async ingestion.
 */
import { Router, type Request, type Response } from 'express';
import { basename, join } from 'node:path';
import { rename } from 'node:fs/promises';
import { getLogger } from '@agentx/shared';
import { isUrlSafeForFetch } from '@agentx/engine';
import { getEngine } from '../engine.js';
import { refreshIngestionRagSourceCount, evaluateIngestionWorker } from '../ingestion-governor.js';
import { buildDistillationGenerator } from '../distillation-generator.js';
import {
  getMemoryService,
  getFabric,
  getQueue,
  handleFabricUnavailable,
  detectKind,
  parseFileContent,
  upload,
  RAG_STUDIO_DIR,
} from './shared.js';

const logger = getLogger();

export function createIngestRouter(): Router {
  const r = Router();

  r.post('/memory/crawl', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    const { url, maxPages, maxBytes, allowPathPrefix } = req.body as Record<string, unknown>;
    if (typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
    try {
      const { WebCrawler } = await import('@agentx/engine');
      const crawler = new WebCrawler(fabric);
      const result = await crawler.crawl(url, {
        maxPages: typeof maxPages === 'number' ? maxPages : 5,
        maxBytes: typeof maxBytes === 'number' ? maxBytes : 500_000,
        allowPathPrefix: typeof allowPathPrefix === 'string' ? allowPathPrefix : undefined,
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to crawl web URL' });
    }
  });

  r.post('/memory/pipeline', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    const { domainCluster } = req.body as Record<string, unknown>;
    try {
      const { MemoryPipeline, MemoryConsolidator, DocumentIngester, OnnxEmbeddingProvider } = await import('@agentx/engine');
      const embedder = new OnnxEmbeddingProvider();
      const pipeline = new MemoryPipeline(fabric, {
        consolidator: new MemoryConsolidator(fabric),
        ingester: new DocumentIngester(fabric),
        domainCluster: domainCluster !== false,
        embed: (text) => embedder.embed(text),
      });
      const result = await pipeline.run();
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to run memory pipeline' });
    }
  });

  r.post('/memory/prune', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    const { sourceId } = req.body as Record<string, unknown>;
    if (typeof sourceId !== 'string') return res.status(400).json({ error: 'sourceId is required' });
    try {
      const result = await fabric.pruneSource(sourceId);
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to prune source' });
    }
  });

  r.post('/memory/backup', async (req: Request, res: Response) => {
    const { connectionString } = getEngine();
    if (!connectionString) return handleFabricUnavailable(res);
    const { filePath, passphrase, schemas } = req.body as Record<string, unknown>;
    if (typeof filePath !== 'string' || typeof passphrase !== 'string') {
      return res.status(400).json({ error: 'filePath and passphrase are required' });
    }
    try {
      const { BrainBackup } = await import('@agentx/engine');
      const backup = new BrainBackup();
      const result = await backup.backup({
        connectionString,
        filePath,
        passphrase,
        schemas: Array.isArray(schemas) ? (schemas as string[]) : undefined,
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to create brain backup' });
    }
  });

  r.post('/memory/restore', async (req: Request, res: Response) => {
    const { connectionString } = getEngine();
    if (!connectionString) return handleFabricUnavailable(res);
    const { filePath, passphrase, clean } = req.body as Record<string, unknown>;
    if (typeof filePath !== 'string' || typeof passphrase !== 'string') {
      return res.status(400).json({ error: 'filePath and passphrase are required' });
    }
    try {
      const { BrainBackup } = await import('@agentx/engine');
      const backup = new BrainBackup();
      const result = await backup.restore({
        connectionString,
        filePath,
        passphrase,
        clean: typeof clean === 'boolean' ? clean : false,
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to restore brain backup' });
    }
  });

  /**
   * POST /memory/ingest-file  — synchronous multi-format file ingestion.
   */
  r.post('/memory/ingest-file', upload.single('file'), async (req: Request, res: Response) => {
    const service = getMemoryService();
    if (!service) return handleFabricUnavailable(res);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const kind = detectKind(req.file.originalname);
      const { content, pages, title } = await parseFileContent(req.file.path, req.file.originalname, kind);
      const generate = await buildDistillationGenerator();
      const result = await service.ingestDocument({
        name: req.file.originalname,
        kind,
        content,
        generate: generate ?? undefined,
        maxEntitiesPerChunk: 50,
        maxChunks: 200,
        metadata: { title, pageCount: pages },
      });
      res.json({ ...result, pages });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to ingest file' });
    }
  });

  /**
   * POST /memory/ingest-async  — enqueue a document_ingest job for background processing.
   */
  r.post('/memory/ingest-async', upload.single('file'), async (req: Request, res: Response) => {
    const queue = getQueue();
    if (!queue) return handleFabricUnavailable(res);
    try {
      let name: string;
      let kind: 'pdf' | 'text' | 'markdown' | 'json' | 'web';
      let content: string;
      let chunkSize: number | undefined;
      let chunkOverlap: number | undefined;
      let filePath: string | undefined;
      let fileSize: number | undefined;
      let fileMime: string | undefined;

      if (req.file) {
        kind = detectKind(req.file.originalname);
        const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ext = basename(req.file.originalname).split('.').pop() ?? '';
        const persistentName = ext ? `${fileId}.${ext}` : fileId;
        const persistentPath = join(RAG_STUDIO_DIR, persistentName);
        try { await rename(req.file.path, persistentPath); } catch { /* if rename fails, fall back to reading from tmp */ }
        filePath = persistentPath;
        fileSize = req.file.size;
        fileMime = req.file.mimetype;
        const parsed = await parseFileContent(persistentPath, req.file.originalname, kind);
        name = req.file.originalname;
        content = parsed.content;
        chunkSize = req.body.chunkSize ? parseInt(req.body.chunkSize, 10) : undefined;
        chunkOverlap = req.body.chunkOverlap ? parseInt(req.body.chunkOverlap, 10) : undefined;
      } else {
        const body = req.body as { name?: string; kind?: string; content?: string; url?: string; chunkSize?: number; chunkOverlap?: number };
        if (!body.content && !body.url) return res.status(400).json({ error: 'Either file upload, content, or url is required' });
        name = body.name ?? 'untitled';
        kind = (body.kind as 'pdf' | 'text' | 'markdown' | 'json' | 'web' | undefined) ?? 'text';
        if (body.url) {
          if (!isUrlSafeForFetch(body.url)) {
            return res.status(400).json({ error: 'URL blocked by SSRF policy' });
          }
          const { extractArticle } = await import('@agentx/engine');
          const resp = await fetch(body.url, { signal: AbortSignal.timeout(30000) });
          const html = await resp.text();
          const article = extractArticle(html);
          content = article.content || html;
          name = body.name ?? article.title ?? body.url;
          kind = 'web';
        } else {
          content = body.content!;
        }
        chunkSize = body.chunkSize;
        chunkOverlap = body.chunkOverlap;
      }

      const job = await queue.enqueue({
        kind: 'document_ingest',
        payload: { name, kind, content, chunkSize, chunkOverlap, filePath, fileSize, fileMime },
        priority: 5,
      });
      const pool = getEngine().pgPool;
      if (pool) {
        void refreshIngestionRagSourceCount(pool).then(() => evaluateIngestionWorker());
      }
      res.json({ jobId: job.id, status: job.status, name, kind });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to enqueue ingestion job' });
    }
  });

  return r;
}
