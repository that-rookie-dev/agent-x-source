import express, { type Request, type Response } from 'express';
import { MemoryFabric, DocumentIngester, CognitiveBenchmark, SecureVault, type MemoryNode, type MemoryNodeCategory } from '@agentx/engine';
import { readFile } from 'node:fs/promises';
import multer from 'multer';
import { getEngine } from './engine.js';
import { validate, memoryNodeCreateSchema, memoryEdgeCreateSchema, memorySearchSchema, memoryGraphWalkSchema, memoryContextSchema, memorySourceCreateSchema, documentIngestSchema, benchmarkRunSchema } from './validation.js';
import { getLogger } from '@agentx/shared';
import { broadcastBrainActivity, broadcast } from './ws.js';

const logger = getLogger();

let fabricInstance: MemoryFabric | null = null;

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
  }
  return fabricInstance;
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
    const isBenchmark = req.query.isBenchmark === 'true' ? true : req.query.isBenchmark === 'false' ? false : undefined;
    const result = await fabric.getGraphSnapshot({
      limit: Number.isNaN(limit) ? 1000 : limit,
      category: category as MemoryNodeCategory,
      tag,
      isBenchmark,
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

const upload = multer({ dest: '/tmp/agentx-memory-uploads', limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/memory/ingest-file', upload.single('file'), async (req: Request, res: Response) => {
  const fabric = getFabric();
  if (!fabric) return handleFabricUnavailable(res);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { parsePdf } = await import('@agentx/engine');
    const { OnnxEmbeddingProvider } = await import('@agentx/engine');
    const buffer = await readFile(req.file.path);
    const parsed = await parsePdf(buffer);
    const ingester = new DocumentIngester(fabric);
    const embedder = new OnnxEmbeddingProvider();
    const result = await ingester.ingest({
      name: req.file.originalname || 'upload.pdf',
      kind: 'pdf',
      content: parsed.text,
      embed: (text) => embedder.embed(text),
    });
    res.json({ ...result, pages: parsed.pages });
  } catch (e) {
    logger.error('MEMORY_API', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Failed to ingest PDF' });
  }
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
    const ingester = new DocumentIngester(fabric);
    const result = await ingester.ingest(req.body);
    for (const n of result.nodes) {
      broadcastBrainActivity({
        type: 'neuron_created',
        nodeId: n.id,
        label: n.label,
        category: 'source_doc',
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
        relationshipType: 'CONTAINS',
        weight: 1.0,
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
