import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn(),
  isStorageDeferred: vi.fn(),
}));

vi.mock('../../src/channels-sync.js', () => ({
  getTelegramInboundStatus: vi.fn(),
}));

import { getEngine, isStorageDeferred } from '../../src/engine.js';
import { getTelegramInboundStatus } from '../../src/channels-sync.js';
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

describe('health router', () => {
  beforeEach(() => {
    (isStorageDeferred as any).mockReturnValue(false);
    (getTelegramInboundStatus as any).mockReturnValue({ inboundReady: false, bridgeRunning: false, botUsername: null });
    (getEngine as any).mockReturnValue({
      configManager: { load: () => ({ provider: { activeProvider: 'test', activeModel: 'model' }, user: { callsign: 'pilot' } }) },
      sessionManager: { listSessions: () => [{ id: 's1' }, { id: 's2' }] },
      crewManager: { list: () => [{ id: 'c1' }] },
      agent: { getHealth: () => ({ status: 'ok' }) },
      gateway: { focus: { getFocus: () => null }, registry: { listChannels: () => [] } },
    });
  });

  it('GET /api/health returns 200 with ok status', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.sessions).toBe(2);
    expect(body.crews).toBe(1);
  });
});
