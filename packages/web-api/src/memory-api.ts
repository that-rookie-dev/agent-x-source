import express, { type Request, type Response } from 'express';
import { MemoryFabric, DocumentIngester, CognitiveBenchmark, SecureVault, IngestionQueue, setMemoryFabricInstance, setEmbedderInstance, OnnxEmbeddingProvider, type MemoryNode, type MemoryNodeCategory } from '@agentx/engine';
import { readFile, rename, mkdir, stat, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import multer from 'multer';
import { getEngine } from './engine.js';
import { validate, memoryNodeCreateSchema, memoryEdgeCreateSchema, memorySearchSchema, memoryGraphWalkSchema, memoryContextSchema, memorySourceCreateSchema, documentIngestSchema, benchmarkRunSchema } from './validation.js';
import { getLogger, getDataDir } from '@agentx/shared';
import { broadcastBrainActivity, broadcast } from './ws.js';
import { getIngestionWorker } from './ingestion-worker-ref.js';
import { buildDistillationGenerator } from './distillation-generator.js';

const logger = getLogger();

// Persistent storage for RAG Studio file uploads.
// Files are kept here so users can re-download or re-ingest them later.
const RAG_STUDIO_DIR = join(getDataDir(), 'rag-studio');
try { if (!existsSync(RAG_STUDIO_DIR)) { void mkdir(RAG_STUDIO_DIR, { recursive: true }); } } catch { /* best-effort */ }

let fabricInstance: MemoryFabric | null = null;
let queueInstance: IngestionQueue | null = null;

function getFabric(): MemoryFabric | null {
  const pool = getEngine().pgPool;
  if (!pool) return null;
  if (!fabricInstance) {
    fabricInstance = new MemoryFabric(pool as any);
    if (process.env['AGENTX_VAULT_KEY']) {
      try {
        const key = Buffer.from(process.env['AGENTX_VAULT_KEY'], 'base64');
        fabricInstance.setVault(new SecureVault(pool as any, () => key));
      } catch (e) {
        logger.error('MEMORY_API', `Failed to initialize secure vault: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Register as global singleton so tools (memory_fabric_search) can access it.
    setMemoryFabricInstance(fabricInstance);
    // Also register a shared embedder instance for tool use.
    try { setEmbedderInstance(new OnnxEmbeddingProvider()); } catch { /* best-effort */ }
  }
  return fabricInstance;
}

function getQueue(): IngestionQueue | null {
  const pool = getEngine().pgPool;
  if (!pool) return null;
  if (!queueInstance) {
    queueInstance = new IngestionQueue(pool as any);
  }
  return queueInstance;
}

// ─── File-type detection helpers ───

const EXT_KIND_MAP: Record<string, 'pdf' | 'text' | 'markdown' | 'json' | 'web'> = {
  '.pdf': 'pdf',
  '.txt': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.htm': 'web',
  '.html': 'web',
};

function detectKind(filename: string): 'pdf' | 'text' | 'markdown' | 'json' | 'web' {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  return EXT_KIND_MAP[ext] ?? 'text';
}

async function parseFileContent(
  filePath: string,
  originalName: string,
  kind: 'pdf' | 'text' | 'markdown' | 'json' | 'web',
): Promise<{ content: string; pages?: number; title?: string }> {
  const buffer = await readFile(filePath);
  if (kind === 'pdf') {
    const { parsePdf } = await import('@agentx/engine');
    const parsed = await parsePdf(buffer);
    return { content: parsed.text, pages: parsed.pages, title: originalName };
  }
  if (kind === 'web') {
    const { extractArticle } = await import('@agentx/engine');
    const html = buffer.toString('utf-8');
    const article = extractArticle(html);
    return { content: article.content || html, title: article.title || originalName };
  }
  // text, markdown, json — read as UTF-8
  return { content: buffer.toString('utf-8'), title: originalName };
}

function handleFabricUnavailable(res: Response): void {
  res.status(503).json({ error: 'Memory fabric unavailable: PostgreSQL pool not connected' });
}

const router: express.Router = express.Router();

router.post('/memory/context', validate(memoryContextSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const { query, sessionId, agentId, limit, useWeights, episodicLimit, semanticLimit, graphDepth } = req.body;
    const { OnnxEmbeddingProvider } = await import('@agentx/engine');
    const embedder = new OnnxEmbeddingProvider();
    const embedding = req.body.embedding ?? await embedder.embed(query);
    const weighted = useWeights
      ? await fabric.searchWeighted(embedding, { limit, agentId })
      : null;
    const semantic = weighted ? weighted.map((n: MemoryNode & { score: number; edgeWeight: number }) => {
      const { score, edgeWeight, ...rest } = n;
      return rest;
    }) : undefined;
    const result = await fabric.assembleContext(sessionId ?? '', embedding, { agentId, episodicLimit: episodicLimit ?? limit ?? 5, semanticLimit: semanticLimit ?? limit ?? 10, graphDepth });
    if (semantic) result.semantic = semantic;
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to assemble context' });
  }
});

router.post('/memory/nodes', validate(memoryNodeCreateSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const node = await fabric.createNode(req.body);
    broadcastBrainActivity({
      type: 'neuron_created',
      nodeId: node.id,
      label: node.label,
      category: node.category,
      content: node.content,
      x: node.x ?? null,
      y: node.y ?? null,
      timestamp: new Date().toISOString(),
    });
    res.json(node);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to create memory node' });
  }
});

router.post('/memory/edges', validate(memoryEdgeCreateSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const edge = await fabric.bindEdge(req.body);
    broadcastBrainActivity({
      type: 'synapse_bound',
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      relationshipType: edge.relationshipType,
      weight: edge.weight,
      timestamp: new Date().toISOString(),
    });
    res.json(edge);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to bind memory edge' });
  }
});

router.post('/memory/neurons/:id/fire', async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'Node id is required' });
  try {
    await fabric.fireNeuron(id);
    res.json({ ok: true });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to fire neuron' });
  }
});

router.get('/memory/nodes/:id', async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'Node id is required' });
  try {
    const node = await fabric.getNode(id);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    res.json(node);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to get memory node' });
  }
});

router.post('/memory/search', validate(memorySearchSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const results = await fabric.vectorSearch(req.body.embedding, {
      limit: req.body.limit,
      category: req.body.category ?? undefined,
      agentId: req.body.agentId ?? undefined,
    });
    res.json(results);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to search memory' });
  }
});

router.post('/memory/graph/walk', validate(memoryGraphWalkSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const result = await fabric.graphWalk(req.body);
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to walk memory graph' });
  }
});

router.get('/memory/graph', async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 1000;
    const category = (req.query.category as string) || undefined;
    const tag = (req.query.tag as string) || undefined;
    const sourceId = (req.query.sourceId as string) || undefined;
    const isBenchmark = req.query.isBenchmark === 'true' ? true : req.query.isBenchmark === 'false' ? false : undefined;
    const result = await fabric.getGraphSnapshot({
      limit: Number.isNaN(limit) ? 1000 : limit,
      category: category as MemoryNodeCategory,
      tag,
      isBenchmark,
      sourceId,
    });
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to get graph snapshot' });
  }
});

router.post('/memory/consolidate', async (req: Request, res: Response) => {
  const { MemoryConsolidator } = await import('@agentx/engine');
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const consolidator = new MemoryConsolidator(fabric);
    const result = await consolidator.consolidate(req.body);
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to consolidate memory' });
  }
});

router.post('/memory/web-stage', async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const { url, domain, kind, rawPayload, sourceId } = req.body as Record<string, unknown>;
    if (typeof url !== 'string' || typeof domain !== 'string') {
      return res.status(400).json({ error: 'url and domain are required' });
    }
    const id = await fabric.stageWebPayload(url, domain, kind as string || 'raw', rawPayload, sourceId as string | undefined);
    res.json({ id });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to stage web payload' });
  }
});

router.post('/memory/benchmark', validate(benchmarkRunSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const execute = await buildBenchmarkExecutor();
    const benchmark = new CognitiveBenchmark(fabric, {
      onEvent: (event) => {
        if (event.type === 'benchmark_neuron_created') {
          broadcastBrainActivity({
            type: 'neuron_created',
            nodeId: event.nodeId,
            label: event.label,
            category: event.category,
            content: '',
            x: 0,
            y: 0,
            timestamp: event.timestamp,
          });
        } else if (event.type === 'benchmark_neuron_failed') {
          broadcastBrainActivity({
            type: 'neuron_decayed',
            nodeId: event.nodeId,
            status: 'failed',
            timestamp: event.timestamp,
          });
        }
        broadcast({ type: 'benchmark_event', event });
      },
    });
    // Run async so the HTTP response can stream progress via WebSocket
    benchmark.run({ ...req.body, execute }).then((result) => {
      broadcast({ type: 'benchmark_result', result });
    }).catch((e: unknown) => {
      broadcast({ type: 'benchmark_error', error: e instanceof Error ? e.message : String(e) });
    });
    res.json({ runId: benchmark.getRunId() });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to start benchmark' });
  }
});

async function buildBenchmarkExecutor(): Promise<((prompt: string) => Promise<string>) | undefined> {
  const eng = getEngine();
  if (!eng.configured) return undefined;
  try {
    const cfg = eng.configManager.load();
    const providerId = cfg.provider.activeProvider;
    const providerCfg = cfg.provider.providers[providerId];
    if (!providerCfg?.configured || !providerCfg?.apiKey) return undefined;
    const { ProviderFactory } = await import('@agentx/engine');
    const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
    const model = cfg.provider.activeModel || 'gpt-4o-mini';
    return async (prompt: string) => {
      let text = '';
      const request = {
        model,
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0,
        maxTokens: 512,
        stream: false,
      };
      for await (const chunk of provider.complete(request)) {
        if (chunk.type === 'text_delta' && chunk.content) text += chunk.content;
      }
      return text;
    };
  } catch {
    return undefined;
  }
}

router.post('/memory/system-init', async (_req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    // Check if system init node already exists to avoid duplicates
    const result = await fabric.seedSystemInitNode();
    res.json({ ok: true, nodeId: result.nodeId, created: result.created });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to create system-init node' });
  }
});

router.get('/memory/storage-status', async (_req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const { MemoryMigrationRunner } = await import('@agentx/engine');
    const runner = new MemoryMigrationRunner(fabric['pool']);
    const { applied, currentVersion } = await fabric.migrate();
    const { available: ageAvailable, error: ageError } = await runner.detectAge();
    res.json({
      postgres: true,
      schemaVersion: currentVersion,
      migrationsApplied: applied,
      age: { available: ageAvailable, error: ageError ?? null },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to get storage status' });
  }
});

router.get('/memory/benchmark/scorecards', async (_req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const scorecards = await fabric.getScorecards(50);
    res.json({ scorecards });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to get scorecards' });
  }
});

router.post('/memory/plasticity', async (req: Request, res: Response) => {
  const { SynapticPlasticity } = await import('@agentx/engine');
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const plasticity = new SynapticPlasticity(fabric);
    const result = await plasticity.run(req.body);
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to run plasticity' });
  }
});

router.post('/memory/wipe-benchmark', async (_req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const result = await fabric.wipeBenchmark();
    broadcastBrainActivity({
      type: 'cluster_layout_updated',
      epoch: 0,
      count: -result.deletedNodes,
      timestamp: new Date().toISOString(),
    });
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to wipe benchmark data' });
  }
});

router.post('/memory/cleanup-dividers', async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const dryRun = req.body?.dryRun === true;
    const result = await fabric.cleanupDividerNodes(dryRun);
    if (!dryRun && result.deletedNodes > 0) {
      broadcastBrainActivity({
        type: 'cluster_layout_updated',
        epoch: 0,
        count: -result.deletedNodes,
        timestamp: new Date().toISOString(),
      });
    }
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to cleanup divider nodes' });
  }
});

router.post('/memory/re-embed', async (_req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const { OnnxEmbeddingProvider } = await import('@agentx/engine');
    const embedder = new OnnxEmbeddingProvider();
    const result = await fabric.reEmbedAll(embedder);
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to re-embed memory' });
  }
});

router.post('/memory/parity-test', async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const { startNodeIds, maxDepth, maxFanOut, minWeight, relationshipTypes } = req.body as Record<string, unknown>;
    if (!Array.isArray(startNodeIds) || startNodeIds.length === 0) {
      return res.status(400).json({ error: 'startNodeIds array is required' });
    }
    const result = await fabric.runGraphWalkParityTest({
      startNodeIds: startNodeIds as string[],
      maxDepth: typeof maxDepth === 'number' ? maxDepth : 2,
      maxFanOut: typeof maxFanOut === 'number' ? maxFanOut : 10,
      minWeight: typeof minWeight === 'number' ? minWeight : 0.1,
      relationshipTypes: Array.isArray(relationshipTypes) ? (relationshipTypes as ('CONTAINS' | 'REFERENCES' | 'NEXT_STEP' | 'REQUIRES' | 'RELATED_TO' | 'GENERATED_OUTPUT' | 'USING_TOOL' | 'SHARED_INSIGHT')[]) : undefined,
    });
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to run parity test' });
  }
});

router.post('/memory/verify-offline', async (_req: Request, res: Response) => {
  try {
    const { verifyOfflineMode } = await import('@agentx/engine');
    const result = await verifyOfflineMode();
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to verify offline mode' });
  }
});

router.post('/memory/vault/restore', async (req: Request, res: Response) => {
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

router.post('/memory/vault/purge', async (req: Request, res: Response) => {
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

router.get('/memory/vault/list', async (req: Request, res: Response) => {
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

router.post('/memory/crawl', async (req: Request, res: Response) => {
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

router.post('/memory/pipeline', async (req: Request, res: Response) => {
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

router.post('/memory/prune', async (req: Request, res: Response) => {
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

router.post('/memory/backup', async (req: Request, res: Response) => {
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

router.post('/memory/restore', async (req: Request, res: Response) => {
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

const upload = multer({ dest: join(RAG_STUDIO_DIR, '_tmp'), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * POST /memory/ingest-file  — synchronous multi-format file ingestion.
 * Supports PDF, text, markdown, JSON, and HTML files. Detects kind from
 * file extension. Broadcasts neuron_created / synapse_bound events as nodes
 * are created (the DocumentIngester fires these via MemoryFabric).
 */
router.post('/memory/ingest-file', upload.single('file'), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const kind = detectKind(req.file.originalname);
    const { content, pages, title } = await parseFileContent(req.file.path, req.file.originalname, kind);
    const { OnnxEmbeddingProvider } = await import('@agentx/engine');
    const generate = await buildDistillationGenerator();
    const ingester = new DocumentIngester(fabric, generate ?? undefined);
    const embedder = new OnnxEmbeddingProvider();
    const result = await ingester.ingest({
      name: req.file.originalname,
      kind,
      content,
      embed: (text) => embedder.embed(text),
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
 * Accepts either a file upload (multipart) or a JSON body with content + kind.
 * Returns the job ID immediately so the client can poll/stream progress.
 */
router.post('/memory/ingest-async', upload.single('file'), async (req: Request, res: Response) => {
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
      // File upload path — persist the file to RAG_STUDIO_DIR, then parse + enqueue.
      kind = detectKind(req.file.originalname);
      const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = basename(req.file.originalname).split('.').pop() ?? '';
      const persistentName = ext ? `${fileId}.${ext}` : fileId;
      const persistentPath = join(RAG_STUDIO_DIR, persistentName);
      // Move from multer tmp dir to persistent location.
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
      // JSON body path — content provided directly (text/markdown/json/web URL content).
      const body = req.body as { name?: string; kind?: string; content?: string; url?: string; chunkSize?: number; chunkOverlap?: number };
      if (!body.content && !body.url) return res.status(400).json({ error: 'Either file upload, content, or url is required' });
      name = body.name ?? 'untitled';
      kind = (body.kind as any) ?? 'text';
      if (body.url) {
        // Fetch web URL content
        const { extractArticle } = await import('@agentx/engine');
        const resp = await fetch(body.url);
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
    res.json({ jobId: job.id, status: job.status, name, kind });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to enqueue ingestion job' });
  }
});

/**
 * GET /memory/jobs  — list recent ingestion jobs.
 */
router.get('/memory/jobs', async (req: Request, res: Response) => {
  const queue = getQueue();
  if (!queue) return handleFabricUnavailable(res);
  try {
    const kind = req.query.kind as any;
    const status = req.query.status as any;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const jobs = await queue.getJobs({ kind, status, limit });
    res.json({ jobs });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

/**
 * GET /memory/jobs/:id  — get a single job status.
 */
router.get('/memory/jobs/:id', async (req: Request, res: Response) => {
  const queue = getQueue();
  if (!queue) return handleFabricUnavailable(res);
  try {
    const job = await queue.getJob(req.params['id']!);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

/**
 * GET /memory/jobs/:id/events  — fetch the full event log for a job.
 * Used by the frontend to populate the log stream when a job is selected.
 */
router.get('/memory/jobs/:id/events', async (req: Request, res: Response) => {
  const queue = getQueue();
  if (!queue) return handleFabricUnavailable(res);
  try {
    const events = await queue.getRecentEvents(req.params['id']!, 500);
    res.json({ events });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

/**
 * POST /memory/jobs/:id/cancel  — cancel a running or pending job.
 */
router.post('/memory/jobs/:id/cancel', async (req: Request, res: Response) => {
  const queue = getQueue();
  if (!queue) return handleFabricUnavailable(res);
  try {
    const jobId = req.params['id']!;
    // Signal the worker to stop processing this job at the next chunk boundary.
    const worker = getIngestionWorker();
    if (worker) {
      await worker.cancelJob(jobId);
    } else {
      // No worker ref — just mark as cancelled in the DB.
      await queue.cancelJob(jobId);
    }
    res.json({ ok: true });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

/**
 * DELETE /memory/jobs/:id  — delete a job and all its events.
 */
router.delete('/memory/jobs/:id', async (req: Request, res: Response) => {
  const queue = getQueue();
  if (!queue) return handleFabricUnavailable(res);
  try {
    const deleted = await queue.deleteJob(req.params['id']!);
    if (!deleted) return res.status(404).json({ error: 'Job not found' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

/**
 * GET /memory/jobs/:id/stream  — SSE stream that polls job progress and pushes
 * updates to the client until the job reaches a terminal state.
 */
router.get('/memory/jobs/:id/stream', async (req: Request, res: Response) => {
  const queue = getQueue();
  if (!queue) return handleFabricUnavailable(res);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const jobId = req.params['id']!;
  let lastEventId = 0;
  let lastStatus = '';
  let firstPoll = true;
  let closed = false;

  req.on('close', () => { closed = true; });

  const poll = async () => {
    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
        return;
      }

      // On the first poll, backfill recent events so the log isn't empty
      // for jobs that started before the stream opened.
      let events;
      if (firstPoll) {
        events = await queue.getRecentEvents(jobId, 200);
        firstPoll = false;
      } else {
        events = await queue.getEventsSince(jobId, lastEventId, 200);
      }

      // Send every new event as a separate SSE data line.
      for (const ev of events) {
        lastEventId = Math.max(lastEventId, ev.id);
        const event = {
          jobId: job.id,
          stage: ev.stage,
          progress: ev.progress,
          status: job.status,
          detail: ev.detail ?? undefined,
          chunkIndex: ev.chunkIndex ?? undefined,
          chunkCount: ev.chunkCount ?? undefined,
          batchIndex: ev.batchIndex ?? undefined,
          batchCount: ev.batchCount ?? undefined,
          inputTokens: ev.inputTokens ?? undefined,
          outputTokens: ev.outputTokens ?? undefined,
          totalInputTokens: job.totalInputTokens ?? undefined,
          totalOutputTokens: job.totalOutputTokens ?? undefined,
          error: job.error ?? undefined,
          updatedAt: new Date(ev.createdAt).toISOString(),
        };
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // If the job status changed (e.g. to done/failed), send a status update
      // even if there are no new events, so the UI transitions correctly.
      if (job.status !== lastStatus) {
        lastStatus = job.status;
        const sd = job.stageDetail;
        const stage = sd?.stage ?? (job.status === 'done' ? 'complete' : job.status === 'failed' ? 'error' : job.status === 'pending' ? 'queued' : 'processing');
        const event = {
          jobId: job.id,
          stage,
          progress: job.progress,
          status: job.status,
          detail: sd?.detail ?? (job.status === 'failed' ? job.error : undefined),
          chunkIndex: sd?.chunkIndex ?? undefined,
          chunkCount: sd?.chunkCount ?? undefined,
          batchIndex: sd?.batchIndex ?? undefined,
          batchCount: sd?.batchCount ?? undefined,
          error: job.error ?? undefined,
          updatedAt: new Date().toISOString(),
        };
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
        return; // terminal — stop polling
      }
    } catch {
      // best-effort — keep polling
    }
    if (!closed) {
      setTimeout(poll, 1000);
    }
  };

  void poll();

  // Keep-alive heartbeat every 15s
  const heartbeat = setInterval(() => {
    if (closed) { clearInterval(heartbeat); return; }
    res.write(': keepalive\n\n');
  }, 15000);
  req.on('close', () => clearInterval(heartbeat));
});

router.get('/memory/graph/layout', async (_req: Request, res: Response) => {
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

router.get('/memory/graph/layout-epoch', async (_req: Request, res: Response) => {
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

router.get('/memory/graph/viewport', async (req: Request, res: Response) => {
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

router.post('/memory/context', validate(memoryContextSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const result = await fabric.assembleContext(req.body.sessionId, req.body.embedding, {
      agentId: req.body.agentId ?? undefined,
      episodicLimit: req.body.episodicLimit,
      semanticLimit: req.body.semanticLimit,
      graphDepth: req.body.graphDepth,
    });
    res.json(result);
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to assemble context' });
  }
});

router.get('/memory/sources', async (_req: Request, res: Response) => {
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
 * Supports pagination via limit/offset and optional category filter.
 */
router.get('/memory/sources/:id/nodes', async (req: Request, res: Response) => {
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
 * Returns 404 if the source has no associated file.
 */
router.get('/memory/sources/:id/file', async (req: Request, res: Response) => {
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
 * GET /memory/rag-studio/storage  — get RAG Studio folder stats (file count, total size).
 */
router.get('/memory/rag-studio/storage', async (_req: Request, res: Response) => {
  try {
    if (!existsSync(RAG_STUDIO_DIR)) {
      return res.json({ fileCount: 0, totalBytes: 0, path: RAG_STUDIO_DIR });
    }
    const entries = await readdir(RAG_STUDIO_DIR);
    let totalBytes = 0;
    let fileCount = 0;
    for (const entry of entries) {
      if (entry === '_tmp') continue; // skip multer tmp dir
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
 * Does NOT delete the knowledge nodes/sources — only the original file copies.
 */
router.delete('/memory/rag-studio/storage', async (_req: Request, res: Response) => {
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
    // Clear file_path references in memory_sources
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

router.post('/memory/sources', validate(memorySourceCreateSchema), async (req: Request, res: Response) => {
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

router.post('/memory/documents', validate(documentIngestSchema), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  try {
    const generate = await buildDistillationGenerator();
    const ingester = new DocumentIngester(fabric, generate ?? undefined);
    const result = await ingester.ingest({
      ...req.body,
      maxEntitiesPerChunk: req.body.maxEntitiesPerChunk ?? 50,
      maxChunks: req.body.maxChunks ?? 200,
    });
    for (const n of result.nodes) {
      broadcastBrainActivity({
        type: 'neuron_created',
        nodeId: n.id,
        label: n.label,
        category: (n.category as any) ?? 'source_doc',
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

export { router as memoryRouter };
