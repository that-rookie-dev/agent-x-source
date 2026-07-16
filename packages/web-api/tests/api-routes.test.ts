import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const mockFabric = {
  createNode: vi.fn(),
  bindEdge: vi.fn(),
  fireNeuron: vi.fn(),
  getNode: vi.fn(),
  graphWalk: vi.fn(),
  getGraphSnapshot: vi.fn(),
  seedSystemInitNode: vi.fn(),
  migrate: vi.fn(),
  getScorecards: vi.fn(),
  wipeBenchmark: vi.fn(),
  cleanupDividerNodes: vi.fn(),
  stageWebPayload: vi.fn(),
  reEmbedAll: vi.fn(),
  getGraphLayout: vi.fn(),
  getGraphLayoutEpoch: vi.fn(),
  getViewport: vi.fn(),
  listSources: vi.fn(),
  getSourceNodes: vi.fn(),
  pruneNodes: vi.fn(),
  createSource: vi.fn(),
  pool: {},
};

const mockMemoryService = {
  getFabric: vi.fn(() => mockFabric),
  assembleContextResult: vi.fn(),
  search: vi.fn(),
  setVault: vi.fn(),
};

vi.mock('@agentx/engine', () => ({
  MemoryService: vi.fn(function (this: any) { return mockMemoryService; }),
  MemoryFabric: vi.fn(),
  CognitiveBenchmark: vi.fn(),
  IngestionQueue: vi.fn(),
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
  MemoryMigrationRunner: vi.fn(() => ({ detectAge: vi.fn(() => ({ available: true, error: null })) })),
  SynapticPlasticity: vi.fn(),
  MemoryConsolidator: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn(), env: { allowLocalModels: false } }));

vi.mock('@agentx/shared', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
  getDataDir: vi.fn(() => '/tmp/agentx-test'),
  isNeuralBrainSupported: vi.fn(() => true),
  isChannelCoveredMcpIntegration: vi.fn(() => false),
}));

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(),
  syncLocalModelConfig: vi.fn(),
  isStorageDeferred: vi.fn(() => false),
}));

vi.mock('../src/ws.js', () => ({
  broadcastBrainActivity: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../src/ingestion-worker-ref.js', () => ({ getIngestionWorker: vi.fn(() => null) }));
vi.mock('../src/ingestion-governor.js', () => ({
  refreshIngestionRagSourceCount: vi.fn(),
  evaluateIngestionWorker: vi.fn(),
}));
vi.mock('../src/distillation-generator.js', () => ({ buildDistillationGenerator: vi.fn() }));

import { getEngine } from '../src/engine.js';
import { memoryRouter } from '../src/memory-api.js';
import localModelRouter from '../src/local-model-api.js';
import embeddingModelRouter from '../src/embedding-model-api.js';
import modelBenchmarkRouter from '../src/model-benchmark-api.js';
import { integrationsRouter } from '../src/integrations-api.js';

const app = express();
app.use(express.json());
app.use('/api', memoryRouter);
app.use('/api', localModelRouter);
app.use('/api', embeddingModelRouter);
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
});

describe('memory-api routes', () => {
  it('returns 503 when fabric is unavailable (no pgPool)', async () => {
    mockEngineState({ pgPool: null });
    const res = await fetch(`${baseUrl}/api/memory/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'n', category: 'episodic', content: 'c' }),
    });
    expect(res.status).toBe(503);
  });

  it('POST /memory/nodes creates a node and broadcasts', async () => {
    mockFabric.createNode.mockResolvedValue({ id: 'n1', label: 'n', category: 'episodic', content: 'c' });
    const res = await fetch(`${baseUrl}/api/memory/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'n', category: 'episodic', content: 'c' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('n1');
    expect(mockFabric.createNode).toHaveBeenCalledOnce();
  });

  it('GET /memory/nodes/:id returns the node', async () => {
    mockFabric.getNode.mockResolvedValue({ id: 'n1', label: 'n' });
    const res = await fetch(`${baseUrl}/api/memory/nodes/n1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('n1');
  });

  it('GET /memory/nodes/:id returns 404 when not found', async () => {
    mockFabric.getNode.mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/api/memory/nodes/missing`);
    expect(res.status).toBe(404);
  });

  it('POST /memory/neurons/:id/fire fires the neuron', async () => {
    mockFabric.fireNeuron.mockResolvedValue(undefined);
    const res = await fetch(`${baseUrl}/api/memory/neurons/n1/fire`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockFabric.fireNeuron).toHaveBeenCalledWith('n1');
  });

  it('POST /memory/search returns search results', async () => {
    mockMemoryService.search.mockResolvedValue([{ id: 'n1', score: 0.9 }]);
    const res = await fetch(`${baseUrl}/api/memory/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ embedding: [0.1, 0.2], limit: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it('POST /memory/context assembles context', async () => {
    mockMemoryService.assembleContextResult.mockResolvedValue({ nodes: [], edges: [] });
    const res = await fetch(`${baseUrl}/api/memory/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test', sessionId: 's1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toEqual([]);
  });

  it('GET /memory/graph returns graph snapshot', async () => {
    mockFabric.getGraphSnapshot.mockResolvedValue({ nodes: [], edges: [] });
    const res = await fetch(`${baseUrl}/api/memory/graph`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toEqual([]);
  });

  it('POST /memory/benchmark/scorecards returns scorecards', async () => {
    mockFabric.getScorecards.mockResolvedValue([{ id: 'sc1' }]);
    const res = await fetch(`${baseUrl}/api/memory/benchmark/scorecards`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scorecards).toHaveLength(1);
  });

  it('POST /memory/wipe-benchmark wipes and broadcasts', async () => {
    mockFabric.wipeBenchmark.mockResolvedValue({ deletedNodes: 5 });
    const res = await fetch(`${baseUrl}/api/memory/wipe-benchmark`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletedNodes).toBe(5);
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

describe('embedding-model-api routes', () => {
  it('GET /embedding-models/status returns model status', async () => {
    const res = await fetch(`${baseUrl}/api/embedding-models/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toBeDefined();
    expect(body.allDownloaded).toBeDefined();
  });

  it('POST /embedding-models/disable-neural-brain returns ok', async () => {
    const res = await fetch(`${baseUrl}/api/embedding-models/disable-neural-brain`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
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
