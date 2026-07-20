import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn(),
  isStorageDeferred: vi.fn(),
  awaitEngineStorageReady: vi.fn(),
  applyChannelsConfig: vi.fn(),
  bootstrapAutomationFromEngine: vi.fn(),
}));

import { getEngine, isStorageDeferred } from '../../src/engine.js';
import { router as healthRouter } from '../../src/routes/health.js';
import { ApiService } from '../../src/services/ApiService.js';

const api = new ApiService();
const app = express();
app.use(express.json());
app.use('/', healthRouter({ api }));

const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function mockEngine(ready: boolean) {
  (isStorageDeferred as any).mockReturnValue(false);
  (getEngine as any).mockReturnValue({
    storageDeferred: false,
    storageAdapter: { isConnected: () => ready },
    pgPool: ready ? { query: vi.fn() } : null,
    serviceContext: {
      cache: { isConnected: () => true },
      channelService: { getStatus: () => [] },
    },
    sessionManager: { listSessions: () => [] },
    crewManager: { list: () => [] },
    configManager: { load: () => ({ provider: { activeProvider: 'test', activeModel: 'model' } }) },
    agent: null,
    gateway: null,
    jobQueue: { getQueueDepth: () => 0 },
  });
}

describe('ready router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/ready returns 503 when storage is not connected', async () => {
    mockEngine(false);
    const res = await fetch(`${baseUrl}/api/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.checks.storage).toBe(false);
  });

  it('GET /api/ready returns 200 when all checks pass', async () => {
    mockEngine(true);
    const res = await fetch(`${baseUrl}/api/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(body.checks.storage).toBe(true);
    expect(body.checks.memory).toBe(true);
    expect(body.checks.cache).toBe(true);
    expect(body.checks.channels).toBe(true);
  });
});
