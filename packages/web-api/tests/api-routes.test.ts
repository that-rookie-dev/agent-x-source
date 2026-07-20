import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const mockFabric = {
  seedSystemInitNode: vi.fn(),
  migrate: vi.fn(),
  getNodesBySource: vi.fn(),
  reEmbedAll: vi.fn(),
  getCortexMeta: vi.fn(),
  getGraphSnapshot: vi.fn(),
  getLayoutEpoch: vi.fn(),
  getViewport: vi.fn(),
  getNode: vi.fn(),
  getNodesByIds: vi.fn(),
  walkGraph: vi.fn(),
  computeLouvainLayout: vi.fn(),
  getPool: vi.fn(),
  pool: {},
};

vi.mock('@agentx/engine', () => ({
  MemoryService: vi.fn(),
  MemoryFabric: vi.fn(),
  CognitiveBenchmark: vi.fn(),
  isUrlSafeForFetch: vi.fn(() => true),
  SystemCapabilityDetector: {
    detect: vi.fn(),
    isLocalModelSupported: vi.fn(() => true),
  },
  MODEL_CATALOG: [{ id: 'smollm-360m', tier: 'basic', sizeGB: 0.3, ramRequirementGB: 2, minCpuCores: 2 }],
  getModelById: vi.fn((id: string) => ({ id, tier: 'basic', sizeGB: 0.3, ramRequirementGB: 2, minCpuCores: 2 })),
  getCompatibleModels: vi.fn(() => [{ id: 'smollm-360m' }]),
  getRecommendedModel: vi.fn(() => ({ id: 'smollm-360m' })),
  setDefaultEmbeddingCacheDir: vi.fn(),
  ProviderFactory: { create: vi.fn(() => ({})) },
  runModelBenchmark: vi.fn(),
  formatBenchmarkLog: vi.fn(() => ''),
  benchmarkArtifactBasename: vi.fn((p: string, m: string) => `${p}-${m}`),
  importMcpConfig: vi.fn(),
  parseMcpImportConfig: vi.fn((body: unknown) => body),
  MemoryMigrationRunner: vi.fn(function MemoryMigrationRunner(this: unknown) {
    return {};
  }),
  SynapticPlasticity: vi.fn(),
  MemoryConsolidator: vi.fn(),
  OnnxEmbeddingProvider: vi.fn(),
  getGlobalBrainEventStreamer: vi.fn(() => ({ on: vi.fn(() => vi.fn()) })),
}));

vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn(), env: { allowLocalModels: false } }));

vi.mock('@agentx/shared', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
  getDataDir: vi.fn(() => '/tmp/agentx-test'),
  isChannelCoveredMcpIntegration: vi.fn(() => false),
  resolveNeuralCortexEmbeddingTier: vi.fn(() => 'minilm'),
}));

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(),
  syncLocalModelConfig: vi.fn(),
  isStorageDeferred: vi.fn(() => false),
}));

vi.mock('../src/memory/shared.js', () => ({
  getFabric: vi.fn(() => mockFabric),
  handleFabricUnavailable: vi.fn((res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(503).json({ error: 'Memory fabric unavailable: PostgreSQL pool not connected' });
  }),
}));

import { getEngine } from '../src/engine.js';
import { getFabric } from '../src/memory/shared.js';
import { neuralCortexRouter } from '../src/routes/neural-cortex/index.js';
import localModelRouter from '../src/local-model-api.js';
import modelBenchmarkRouter from '../src/model-benchmark-api.js';
import { integrationsRouter } from '../src/integrations-api.js';

const app = express();
app.use(express.json());
app.use('/api', neuralCortexRouter());
app.use('/api', localModelRouter);
app.use('/api', modelBenchmarkRouter);
app.use('/api', integrationsRouter);

const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function mockEngineState(opts: { pgPool?: unknown; integrationHub?: unknown } = {}) {
  (getEngine as any).mockReturnValue({
    pgPool: opts.pgPool !== undefined ? opts.pgPool : { query: vi.fn() },
    integrationHub: opts.integrationHub ?? {
      listCatalog: vi.fn(() => []),
      getSettings: vi.fn(() => ({})),
      getCatalogStats: vi.fn(() => ({})),
      listConnections: vi.fn(() => []),
      getAuditTail: vi.fn(() => []),
      getAnalytics: vi.fn(() => ({})),
      updateSettings: vi.fn(),
      preflightProvider: vi.fn(),
      probeConnection: vi.fn(),
      connect: vi.fn(() => ({ displayName: 'test' })),
      startOAuth: vi.fn(),
      getOAuthRedirectUri: vi.fn(() => 'http://redirect'),
      getOAuthResult: vi.fn(),
      completeOAuth: vi.fn(() => ({ displayName: 'test' })),
      recordOAuthFailure: vi.fn(),
      runMcpStdioAuth: vi.fn(),
      startMcpStdioBrowserOAuth: vi.fn(),
      getMcpStdioAuthResult: vi.fn(),
      getMcpStdioAuthRedirectUri: vi.fn(),
      getMcpAuthStatus: vi.fn(),
      listResources: vi.fn(() => []),
      removeConnection: vi.fn(),
      syncConnection: vi.fn(),
      runTool: vi.fn(),
      getHealth: vi.fn(() => ({ healthy: true })),
    },
    toolkit: { registry: {}, executor: {} },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEngineState();
  (getFabric as any).mockReturnValue(mockFabric);
});

describe('neural-cortex-api routes', () => {
  it('returns 503 when fabric is unavailable', async () => {
    (getFabric as any).mockReturnValue(null);
    const res = await fetch(`${baseUrl}/api/neural-cortex/storage-status`);
    expect(res.status).toBe(503);
  });

  it('GET /neural-cortex/storage-status returns storage info', async () => {
    mockFabric.migrate.mockResolvedValue({ applied: 0, currentVersion: 21 });
    const res = await fetch(`${baseUrl}/api/neural-cortex/storage-status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.postgres).toBe(true);
    expect(body.schemaVersion).toBe(21);
  });

  it('POST /neural-cortex/system-init seeds system node', async () => {
    mockFabric.seedSystemInitNode.mockResolvedValue({ nodeId: 'sys1', created: true });
    const res = await fetch(`${baseUrl}/api/neural-cortex/system-init`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.nodeId).toBe('sys1');
  });

  it('GET /neural-cortex/sources/:id/nodes lists nodes', async () => {
    mockFabric.getNodesBySource.mockResolvedValue({ nodes: [{ id: 'n1' }], total: 1 });
    const res = await fetch(`${baseUrl}/api/neural-cortex/sources/src1/nodes`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
  });
});

describe('neural-cortex graph routes', () => {
  const sampleNode = {
    id: 'n1', label: 'Fact about auth', category: 'semantic', content: 'JWT tokens expire after 24h.',
    x: 12.5, y: -4.2, communityId: '3', sourceId: null, sessionId: null, tag: null,
    confidence: 0.9, accessCount: 7, lastAccessedAt: null, createdAt: new Date().toISOString(),
  };

  it('GET /graph/meta returns cortex stats', async () => {
    mockFabric.getCortexMeta.mockResolvedValue({
      nodeCount: 42, edgeCount: 61, communityCount: 4, layoutEpoch: 2,
      categories: [{ category: 'semantic', count: 42 }], growth: [], lastNodeAt: null,
    });
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/meta`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodeCount).toBe(42);
    expect(body.communityCount).toBe(4);
  });

  it('GET /graph/snapshot returns trimmed wire nodes and edges', async () => {
    mockFabric.getGraphSnapshot.mockResolvedValue({
      nodes: [sampleNode],
      edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', relationshipType: 'RELATED_TO', weight: 0.7 }],
    });
    mockFabric.getLayoutEpoch.mockResolvedValue(2);
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/snapshot?limit=100`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.epoch).toBe(2);
    expect(body.nodes[0].contentPreview).toBe('JWT tokens expire after 24h.');
    expect(body.nodes[0].content).toBeUndefined();
    expect(body.edges[0]).toEqual({ id: 'e1', source: 'n1', target: 'n2', type: 'RELATED_TO', weight: 0.7 });
  });

  it('GET /graph/viewport validates bounds', async () => {
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/viewport?xmin=abc`);
    expect(res.status).toBe(400);
  });

  it('GET /graph/viewport returns spatial slice', async () => {
    mockFabric.getViewport.mockResolvedValue({ nodes: [sampleNode], edges: [], epoch: 2, band: 'A' });
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/viewport?xmin=-100&xmax=100&ymin=-100&ymax=100&zoom=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.band).toBe('A');
    expect(body.nodes).toHaveLength(1);
  });

  it('GET /graph/node/:id returns detail with connections', async () => {
    mockFabric.getNode.mockResolvedValue({ ...sampleNode, content: 'full content' });
    mockFabric.walkGraph.mockResolvedValue({
      nodeIds: ['n1', 'n2'],
      edges: [{ sourceNodeId: 'n1', targetNodeId: 'n2', relationshipType: 'RELATED_TO', weight: 0.5 }],
    });
    mockFabric.getNodesByIds.mockResolvedValue([{ ...sampleNode, id: 'n2', label: 'Neighbor' }]);
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/node/n1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.node.content).toBe('full content');
    expect(body.connections[0].neighborLabel).toBe('Neighbor');
  });

  it('GET /graph/node/:id returns 404 for missing node', async () => {
    mockFabric.getNode.mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/node/missing`);
    expect(res.status).toBe(404);
  });

  it('GET /graph/neighborhood/:id hydrates walk results', async () => {
    mockFabric.walkGraph.mockResolvedValue({ nodeIds: ['n1', 'n2'], edges: [] });
    mockFabric.getNodesByIds.mockResolvedValue([sampleNode]);
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/neighborhood/n1?depth=2`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
    expect(mockFabric.walkGraph).toHaveBeenCalledWith(expect.objectContaining({ maxDepth: 2 }));
  });

  it('GET /graph/search returns empty for short queries', async () => {
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/search?q=a`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
  });

  it('POST /graph/layout triggers server-side re-layout', async () => {
    mockFabric.computeLouvainLayout.mockResolvedValue({ epoch: 3, count: 42, communities: 5 });
    const res = await fetch(`${baseUrl}/api/neural-cortex/graph/layout`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.epoch).toBe(3);
    expect(body.communities).toBe(5);
  });
});

describe('embedding routes (neural-cortex)', () => {
  it('GET /neural-cortex/embeddings/status returns model status', async () => {
    const res = await fetch(`${baseUrl}/api/neural-cortex/embeddings/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toBeDefined();
    expect(body.allDownloaded).toBeDefined();
    expect(body.cortexReady).toBeDefined();
    expect(body.cortexDegraded).toBeDefined();
  });

  it('DELETE /neural-cortex/embeddings purges models', async () => {
    const res = await fetch(`${baseUrl}/api/neural-cortex/embeddings`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('local-model-api routes', () => {
  it('GET /local-model/capabilities returns capabilities', async () => {
    const { SystemCapabilityDetector } = await import('@agentx/engine');
    (SystemCapabilityDetector.detect as any).mockResolvedValue({
      canRunBasic: true, canRunStandard: false, canRunAdvanced: false,
      totalMemoryGB: 16, cpuCores: 8, availableDiskGB: 100,
    });
    const res = await fetch(`${baseUrl}/api/local-model/capabilities`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.localModelSupported).toBe(true);
  });

  it('GET /local-model/catalog returns catalog', async () => {
    const { SystemCapabilityDetector } = await import('@agentx/engine');
    (SystemCapabilityDetector.detect as any).mockResolvedValue({
      canRunBasic: true, canRunStandard: false, canRunAdvanced: false,
      totalMemoryGB: 16, cpuCores: 8, availableDiskGB: 100,
    });
    const res = await fetch(`${baseUrl}/api/local-model/catalog`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.catalog).toBeDefined();
    expect(body.compatible).toContain('smollm-360m');
  });

  it('POST /local-model/download returns 400 when modelId missing', async () => {
    const res = await fetch(`${baseUrl}/api/local-model/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /local-model/download returns 404 for unknown model', async () => {
    const { getModelById } = await import('@agentx/engine');
    (getModelById as any).mockReturnValue(null);
    const res = await fetch(`${baseUrl}/api/local-model/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'unknown' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('model-benchmark-api routes', () => {
  it('POST /model-benchmark/start returns 400 when providerId missing', async () => {
    const res = await fetch(`${baseUrl}/api/model-benchmark/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'm1' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /model-benchmark/latest returns 400 when params missing', async () => {
    const res = await fetch(`${baseUrl}/api/model-benchmark/latest`);
    expect(res.status).toBe(400);
  });

  it('GET /model-benchmark/log returns 400 when params missing', async () => {
    const res = await fetch(`${baseUrl}/api/model-benchmark/log`);
    expect(res.status).toBe(400);
  });

  it('GET /model-benchmark/log-path returns path info', async () => {
    const res = await fetch(`${baseUrl}/api/model-benchmark/log-path?providerId=openai&modelId=gpt-4o`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logFile).toBeDefined();
    expect(body.exists).toBe(false);
  });
});

describe('integrations-api routes', () => {
  it('GET /integrations/catalog returns catalog and settings', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/catalog`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toEqual([]);
    expect(body.settings).toEqual({});
  });

  it('GET /integrations/connections returns filtered connections', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/connections`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toEqual([]);
  });

  it('GET /integrations/audit returns audit entries', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/audit?limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });

  it('GET /integrations/analytics returns analytics', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/analytics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analytics).toBeDefined();
  });

  it('GET /integrations/settings returns settings', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/settings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual({});
  });

  it('POST /integrations/settings updates settings', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoSync: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual({});
  });

  it('POST /integrations/preflight returns 400 when providerId missing', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /integrations/oauth/redirect-uri returns redirect uri', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/oauth/redirect-uri`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectUri).toBe('http://redirect');
  });
});
