/**
 * Memory sources route group.
 *
 * Extracted from memory-api.ts. Handles source listing, node browsing,
 * file download, RAG Studio storage management, source creation, and
 * document ingestion.
 */
import { Router, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { stat, readdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { MemoryNodeCategory } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { validate, memorySourceCreateSchema, documentIngestSchema } from '../validation.js';
import { broadcastBrainActivity } from '../ws.js';
import { getEngine } from '../engine.js';
import { buildDistillationGenerator } from '../distillation-generator.js';
import { getMemoryService, getFabric, handleFabricUnavailable, RAG_STUDIO_DIR } from './shared.js';

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
   * GET /memory/sources/:id/file  — download the original file for a source.
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

  /**
   * GET /memory/rag-studio/storage  — get RAG Studio folder stats.
   */
  r.get('/memory/rag-studio/storage', async (_req: Request, res: Response) => {
    try {
      if (!existsSync(RAG_STUDIO_DIR)) {
        return res.json({ fileCount: 0, totalBytes: 0, path: RAG_STUDIO_DIR });
      }
      const entries = await readdir(RAG_STUDIO_DIR);
      let totalBytes = 0;
      let fileCount = 0;
      for (const entry of entries) {
        if (entry === '_tmp') continue;
        const fullPath = join(RAG_STUDIO_DIR, entry);
        try {
          const st = await stat(fullPath);
          if (st.isFile()) {
            totalBytes += st.size;
            fileCount++;
          }
        } catch { /* skip */ }
      }
      res.json({ fileCount, totalBytes, path: RAG_STUDIO_DIR });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get storage stats' });
    }
  });

  /**
   * DELETE /memory/rag-studio/storage  — clear all persisted RAG Studio files.
   */
  r.delete('/memory/rag-studio/storage', async (_req: Request, res: Response) => {
    try {
      if (!existsSync(RAG_STUDIO_DIR)) {
        return res.json({ ok: true, deletedFiles: 0, freedBytes: 0 });
      }
      const entries = await readdir(RAG_STUDIO_DIR);
      let deletedFiles = 0;
      let freedBytes = 0;
      for (const entry of entries) {
        if (entry === '_tmp') continue;
        const fullPath = join(RAG_STUDIO_DIR, entry);
        try {
          const st = await stat(fullPath);
          if (st.isFile()) {
            freedBytes += st.size;
            await rm(fullPath);
            deletedFiles++;
          }
        } catch { /* skip */ }
      }
      const fabric = getFabric();
      if (fabric) {
        try {
          const pool = getEngine().pgPool;
          if (pool) await pool.query('UPDATE memory_sources SET file_path = NULL, file_size = NULL, file_mime = NULL WHERE file_path IS NOT NULL');
        } catch { /* best-effort */ }
      }
      res.json({ ok: true, deletedFiles, freedBytes });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to clear RAG Studio storage' });
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

  r.post('/memory/documents', validate(documentIngestSchema), async (req: Request, res: Response) => {
    const service = getMemoryService();
    if (!service) return handleFabricUnavailable(res);
    try {
      const generate = await buildDistillationGenerator();
      const result = await service.ingestDocument({
        ...req.body,
        generate: generate ?? undefined,
        maxEntitiesPerChunk: req.body.maxEntitiesPerChunk ?? 50,
        maxChunks: req.body.maxChunks ?? 200,
      });
      for (const n of result.nodes) {
        broadcastBrainActivity({
          type: 'neuron_created',
          nodeId: n.id,
          label: n.label,
          category: (n.category as string | undefined) ?? 'source_doc',
          content: n.content,
          x: 0,
          y: 0,
          timestamp: new Date().toISOString(),
        });
      }
      for (const e of result.edges) {
        broadcastBrainActivity({
          type: 'synapse_bound',
          edgeId: e.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          relationshipType: e.relationshipType ?? 'CONTAINS',
          weight: e.weight ?? 1.0,
          timestamp: new Date().toISOString(),
        });
      }
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to ingest document' });
    }
  });

  return r;
}
