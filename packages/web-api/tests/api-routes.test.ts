import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const mockFabric = {
  seedSystemInitNode: vi.fn(),
  migrate: vi.fn(),
  getNodesBySource: vi.fn(),
  reEmbedAll: vi.fn(),
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
