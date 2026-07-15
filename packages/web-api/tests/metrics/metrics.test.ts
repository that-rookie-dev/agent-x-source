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

import { getEngine } from '../../src/engine.js';
import { router as metricsRouter } from '../../src/routes/metrics.js';
import { ApiService } from '../../src/services/ApiService.js';

const api = new ApiService();
const app = express();
app.use(express.json());
app.use('/', metricsRouter({ api }));

const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('metrics router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getEngine as any).mockReturnValue({
      storageDeferred: false,
      storageAdapter: { isConnected: () => true },
      pgPool: { query: vi.fn() },
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
  });

  it('GET /api/metrics returns text/plain containing nodejs metrics', async () => {
    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('nodejs');
    expect(body).toContain('agent_turns_total');
  });
});
