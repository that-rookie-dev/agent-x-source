import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(),
  createAgent: vi.fn(),
  destroyAgent: vi.fn(),
  clearEngine: vi.fn(),
  getOrCreateAgent: vi.fn(),
  ensureChannelAgent: vi.fn(),
  getAutonomyStatus: vi.fn().mockReturnValue({}),
  awaitEngineStorageReady: vi.fn().mockResolvedValue(undefined),
  applyRuntimeSettings: vi.fn(),
  isStorageDeferred: vi.fn().mockReturnValue(false),
  setStorageProgressCallback: vi.fn(),
}));

vi.mock('../src/channels-sync.js', () => ({
  applyChannelsConfig: vi.fn().mockResolvedValue(undefined),
  discoverTelegramBot: vi.fn().mockResolvedValue({ ok: true }),
  getTelegramInboundStatus: vi.fn().mockReturnValue({ inboundReady: false, bridgeRunning: false }),
  getTelegramRuntimeHints: vi.fn().mockReturnValue({}),
  restartTelegramInbound: vi.fn().mockResolvedValue({ ok: true, status: {} }),
  saveVerifiedTelegram: vi.fn().mockResolvedValue({ ok: true }),
  sendTelegramGreeting: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../src/channel-session-bridge.js', () => ({
  initChannelSessionBridge: vi.fn(),
  handleChannelHandoffRequest: vi.fn(),
  maybeAugmentChatInstruction: vi.fn(),
}));

vi.mock('../src/config-redaction.js', () => ({
  redactConfigForClient: vi.fn((cfg: unknown) => cfg),
  mergeConfigPreservingSecrets: vi.fn((a: unknown, b: unknown) => b),
  redactProvidersForClient: vi.fn((p: unknown) => p),
  REDACTED_SECRET: '***',
}));

vi.mock('../src/host-crew-session.js', () => ({
  resolveHostCrewDisplay: vi.fn().mockReturnValue(null),
  resolveCrewPrivateHostForSession: vi.fn().mockReturnValue(null),
  syncHostCrewHonorificToSession: vi.fn(),
}));

vi.mock('../src/auth.js', () => ({
  authMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
  createAuthRouter: vi.fn(() => express.Router()),
}));

vi.mock('../src/ws.js', () => ({
  setupWebSocket: vi.fn(),
  ensureSubscribed: vi.fn(),
  persistMessageDirect: vi.fn(),
}));

vi.mock('../src/voice-ws.js', () => ({
  setupVoiceWebSocket: vi.fn(),
  shutdownVoiceWebSocket: vi.fn(),
}));

vi.mock('../src/ws-upgrade-router.js', () => ({
  attachWebSocketUpgradeRouter: vi.fn(),
}));

vi.mock('../src/turn-registry.js', () => ({
  turnRegistry: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() },
}));

vi.mock('../src/chat-helpers.js', () => ({
  sessionSettings: vi.fn().mockReturnValue({}),
  buildFullText: vi.fn(),
  runAgentTurnAsync: vi.fn(),
  isCrewPrivateSessionRecord: vi.fn().mockReturnValue(false),
  loadTurnFeedbackForSession: vi.fn().mockReturnValue([]),
  recordTurnFeedback: vi.fn(),
  loadSessionMessagesPage: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
  getForceWebSearchError: vi.fn().mockReturnValue(null),
  cancelActiveSessionTurn: vi.fn(),
}));

vi.mock('../src/message-enrich.js', () => ({
  enrichSessionMessagesForUi: vi.fn((msgs: unknown) => msgs),
  mergeNormalizedMessageForApi: vi.fn(),
}));

vi.mock('../src/validation.js', () => ({
  validate: () => (_req: any, _res: any, next: any) => next(),
  chatMessageSchema: {},
  chatSteerSchema: {},
  permissionRespondSchema: {},
  permissionInstructSchema: {},
  permissionRespondBatchSchema: {},
  createSessionSchema: {},
  createCheckpointSchema: {},
  generateTitleSchema: {},
  crewSuggestionEvaluateSchema: {},
  crewSuggestionResolveSchema: {},
  crewChatSessionSchema: {},
  crewChatVoiceSessionSchema: {},
  turnFeedbackSchema: {},
  clarificationRespondSchema: {},
  crewRosterPickerOfferSchema: {},
  crewRosterPickerUpdateSchema: {},
  sessionMessagesQuerySchema: {},
}));

vi.mock('../src/crew-suggestions.js', () => ({
  postCrewSuggestionEvaluate: vi.fn(),
  postCrewSuggestionResolve: vi.fn(),
  postCrewSuggestionClearDismiss: vi.fn(),
  getCatalogEntry: vi.fn(),
  getCatalogSeedStatusHandler: vi.fn(),
  listCatalogCategories: vi.fn(),
  listCatalogByCategory: vi.fn(),
  searchCatalogEntries: vi.fn(),
  emitCrewSuggestionTelemetry: vi.fn(),
  blockForCrewSuggestionIfNeeded: vi.fn(),
}));

vi.mock('../src/crew-roster-picker-api.js', () => ({
  persistCrewRosterPickerOffer: vi.fn(),
  updateCrewRosterPickerStatus: vi.fn(),
}));

vi.mock('../src/clarification-resume.js', () => ({
  handleClarificationRespond: vi.fn(),
}));

vi.mock('../src/session-resume-state.js', () => ({
  loadSessionResumeState: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/crew-chat.js', () => ({
  postCrewChatSession: vi.fn(),
  postCrewChatVoiceSession: vi.fn(),
  listCrewChatVoiceSessions: vi.fn(),
  deleteCrewChatVoiceSession: vi.fn(),
}));

vi.mock('../src/agent-x-core.js', () => ({
  postAgentXCoreSession: vi.fn(),
}));

vi.mock('../src/routes/jobs.js', () => ({
  router: () => express.Router(),
}));

vi.mock('../src/local-model-api.js', () => ({
  default: express.Router(),
}));

vi.mock('../src/embedding-model-api.js', () => ({
  default: express.Router(),
}));

vi.mock('../src/model-benchmark-api.js', () => ({
  default: express.Router(),
}));

vi.mock('../src/voice-api.js', () => ({
  default: express.Router(),
}));

vi.mock('../src/integrations-api.js', () => ({
  integrationsRouter: express.Router(),
  handleMcpStdioOAuthCallback: vi.fn(),
}));

vi.mock('../src/automation/index.js', () => ({
  registerAutomationRoutes: vi.fn(),
  bootstrapAutomationFromEngine: vi.fn(),
  shutdownAutomation: vi.fn(),
}));

vi.mock('../src/markdown-api.js', () => ({
  registerMarkdownRoutes: vi.fn(),
}));

vi.mock('../src/agent-x-overview-bridge.js', () => ({
  initAgentXOverviewBridge: vi.fn(),
  shutdownAgentXOverviewBridge: vi.fn(),
}));

vi.mock('../src/pg-lifecycle-bridge.js', () => ({
  registerEmbeddedPostgresController: vi.fn(),
  startEmbeddedPostgresViaBridge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/db-extension-checks.js', () => ({}));

import { getEngine } from '../src/engine.js';
import { redactConfigForClient } from '../src/config-redaction.js';
import { router as legacyRouter } from '../src/routes/legacy.js';
import { ApiService } from '../src/services/ApiService.js';

const api = new ApiService();
const app = express();
app.use(express.json());
app.use('/', legacyRouter({ api }));

const server = createServer(app);
server.listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('legacy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (redactConfigForClient as any).mockImplementation((cfg: unknown) => cfg);
  });

  describe('GET /api/config', () => {
    it('returns 200 with redacted config when configured', async () => {
      const mockConfig = { provider: { activeProvider: 'openai', activeModel: 'gpt-4' } };
      (getEngine as any).mockReturnValue({
        configManager: { load: () => mockConfig },
        sessionManager: { listSessions: () => [] },
        crewManager: { list: () => [] },
      });

      const res = await fetch(`${baseUrl}/api/config`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.provider.activeProvider).toBe('openai');
    });

    it('returns 400 when config load throws', async () => {
      (getEngine as any).mockReturnValue({
        configManager: { load: () => { throw new Error('not configured'); } },
      });

      const res = await fetch(`${baseUrl}/api/config`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('GET /api/sessions', () => {
    it('returns 200 with session list', async () => {
      (getEngine as any).mockReturnValue({
        configManager: { load: () => ({}) },
        sessionManager: {
          listSessions: () => [
            { id: 's1', title: 'Session 1', status: 'active', createdAt: '2024-01-01' },
            { id: 's2', title: 'Session 2', status: 'idle', createdAt: '2024-01-02' },
          ],
        },
        crewManager: { list: () => [], get: () => undefined },
      });

      const res = await fetch(`${baseUrl}/api/sessions`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
    });

    it('returns 500 when engine throws', async () => {
      (getEngine as any).mockImplementation(() => { throw new Error('engine error'); });

      const res = await fetch(`${baseUrl}/api/sessions`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('GET /api/sessions/:id/children', () => {
    it('returns 200 with children array', async () => {
      (getEngine as any).mockReturnValue({
        sessionManager: {
          getChildSessions: () => [{ id: 'child1' }, { id: 'child2' }],
        },
      });

      const res = await fetch(`${baseUrl}/api/sessions/parent1/children`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.children).toHaveLength(2);
    });

    it('returns empty children when method not available', async () => {
      (getEngine as any).mockReturnValue({
        sessionManager: {},
      });

      const res = await fetch(`${baseUrl}/api/sessions/parent1/children`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.children).toEqual([]);
    });
  });

  describe('GET /api/runtime/status', () => {
    it('returns 200 with runtime status', async () => {
      (getEngine as any).mockReturnValue({
        configManager: { load: () => ({ runtime: {} }) },
      });

      const res = await fetch(`${baseUrl}/api/runtime/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('cpuCores');
      expect(body).toHaveProperty('backgroundPool');
      expect(body).toHaveProperty('restartRequired');
    });

    it('returns 200 with defaults when config load fails', async () => {
      (getEngine as any).mockReturnValue({
        configManager: { load: () => { throw new Error('fail'); } },
      });

      const res = await fetch(`${baseUrl}/api/runtime/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cpuCores).toBeGreaterThan(0);
      expect(body.backgroundPool).toEqual({ running: 0, pending: 0 });
    });
  });
});
