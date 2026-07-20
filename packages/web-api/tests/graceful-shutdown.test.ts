import { describe, it, expect, vi, afterAll } from 'vitest';

vi.hoisted(() => {
  process.env['AGENTX_TEST'] = 'true';
});

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn().mockReturnValue({
    integrationHub: { setRedirectBaseUrl: vi.fn() },
    serviceContext: {
      channelService: { stop: vi.fn().mockResolvedValue(undefined) },
    },
    storageReady: Promise.resolve(),
    pgPool: { query: vi.fn() },
    jobQueue: { getQueueDepth: () => 0, stop: vi.fn() },
    sessionManager: { listSessions: () => [] },
  }),
  awaitEngineStorageReady: vi.fn().mockResolvedValue(undefined),
  isStorageDeferred: vi.fn().mockReturnValue(false),
  createAgent: vi.fn(),
  destroyAgent: vi.fn(),
  clearEngine: vi.fn(),
  getOrCreateAgent: vi.fn(),
  ensureChannelAgent: vi.fn(),
  getVitals: vi.fn(),
  getAutonomyStatus: vi.fn(),
  applyRuntimeSettings: vi.fn(),
  setEngineDEK: vi.fn(),
}));

vi.mock('../src/channels-sync.js', () => ({
  applyChannelsConfig: vi.fn().mockResolvedValue(undefined),
  getTelegramInboundStatus: vi.fn(),
  getTelegramRuntimeHints: vi.fn(),
  discoverTelegramBot: vi.fn(),
  restartTelegramInbound: vi.fn(),
  saveVerifiedTelegram: vi.fn(),
  sendTelegramGreeting: vi.fn(),
}));

vi.mock('../src/automation/index.js', () => ({
  registerAutomationRoutes: vi.fn(),
  bootstrapAutomationFromEngine: vi.fn(),
  shutdownAutomation: vi.fn().mockResolvedValue(undefined),
  getAutomationService: vi.fn(),
}));

vi.mock('../src/agent-x-overview-bridge.js', () => ({
  initAgentXOverviewBridge: vi.fn(),
  shutdownAgentXOverviewBridge: vi.fn().mockResolvedValue(undefined),
}));

import { server, startServer } from '../src/index.js';

describe('graceful shutdown', () => {
  it('startServer registers signal handlers and closes on SIGTERM', async () => {
    const listener = startServer(0);
    expect(listener).toBeTruthy();

    // Wait for the server to be listening.
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (server.listening) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    expect(server.listening).toBe(true);

    process.emit('SIGTERM');

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (!server.listening) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 2000);
    });

    expect(server.listening).toBe(false);
  });
});
