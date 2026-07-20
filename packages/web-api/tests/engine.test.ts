import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@agentx/engine', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    isConfigured: () => false,
    load: () => { throw new Error('not configured'); },
    save: vi.fn(),
    setDEK: vi.fn(),
    getPostgresConnectionString: () => undefined,
  })),
  Agent: vi.fn(),
  SessionManager: vi.fn().mockImplementation(() => ({ store: undefined })),
  ProviderFactory: { create: vi.fn() },
  CrewManager: vi.fn().mockImplementation(() => ({})),
  createDefaultToolkit: vi.fn().mockReturnValue({
    registry: {},
    executor: { setScopePath: vi.fn() },
  }),
  DefaultTelemetryBus: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
  })),
  MemoryVectorStore: vi.fn(),
  LLMEmbeddingProvider: vi.fn(),
  RAGEngine: vi.fn(),
  PluginRegistry: vi.fn().mockImplementation(() => ({
    getConfig: () => ({}),
    getPlugin: () => undefined,
    install: vi.fn(),
    updateConfig: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    isInstalled: () => false,
  })),
  PostgresStorageAdapter: vi.fn(),
  Gateway: vi.fn(),
  TelegramBridge: vi.fn(),
  TelegramChannelPlugin: vi.fn(),
  DiscordBridge: vi.fn(),
  SlackBridge: vi.fn(),
  EmailBridge: vi.fn(),
  RedisCacheRuntime: vi.fn(),
  WebhookNotifierRuntime: vi.fn(),
  SessionLogger: vi.fn(),
  initLogCollector: vi.fn(),
  getLogCollector: vi.fn(),
  GrowthEngine: vi.fn(),
  EmotionEngine: vi.fn(),
  ExperienceEngine: vi.fn(),
  createPgNeuralDb: vi.fn(),
  healDatabaseStore: vi.fn(),
  startPeriodicDatabaseHeal: vi.fn(),
  resetCatalogSeedInflight: vi.fn(),
  buildCrewPrivateIdentityPrompt: vi.fn(),
  applyWebSearchConfigFromAgentConfig: vi.fn(),
  MemoryFabric: vi.fn(),
  setLocalModelConfig: vi.fn(),
  IntegrationHub: vi.fn().mockImplementation(() => ({
    setDek: vi.fn(),
    restoreAll: vi.fn().mockResolvedValue(undefined),
    setToolkitBridge: vi.fn(),
    syncToToolkit: vi.fn(),
  })),
  configureBackgroundTaskPool: vi.fn(),
  setOnnxThreadConfig: vi.fn(),
  MarkdownDocumentStore: vi.fn(),
  setMarkdownDocumentStoreInstance: vi.fn(),
  InMemoryQueue: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
  })),
  PgBossQueue: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
  })),
  registerNoOpJobWorkers: vi.fn(),
  createServiceContext: vi.fn().mockReturnValue({
    channelService: null,
  }),
  ChannelService: vi.fn(),
  setDefaultEmbeddingCacheDir: vi.fn(),
  setEmbedderInstance: vi.fn(),
  setMemoryFabricInstance: vi.fn(),
  backfillChatMemoryFromSessions: vi.fn(),
  setDeepSearchStageResult: vi.fn(),
  ensureLoginShellPath: vi.fn(),
  getBackgroundTaskPool: vi.fn().mockReturnValue({ running: 0, pending: 0 }),
  IngestionQueue: vi.fn(),
  IngestionWorker: vi.fn(),
  OnnxEmbeddingProvider: vi.fn(),
  DiscordStore: vi.fn(),
  SlackStore: vi.fn(),
  validateWebSearchProvider: vi.fn(),
  isWebSearchAvailableForChat: vi.fn().mockReturnValue(false),
  mergeWebSearchToolsConfig: vi.fn(),
  PostgresStorageAdapter: vi.fn(),
}));

vi.mock('@agentx/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/shared')>();
  return {
    ...actual,
    getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../src/ws.js', () => ({
  unsubscribeAgent: vi.fn(),
}));

vi.mock('../src/host-crew-session.js', () => ({
  resolveCrewPrivateHostForAgent: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/clarification-resume.js', () => ({
  persistClarificationResumeFromAgent: vi.fn(),
}));

vi.mock('../src/chat-helpers.js', () => ({
  sessionSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../src/deferred-storage.js', () => ({
  DeferredStorageAdapter: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  setStorageProgressCallback,
  applyRuntimeSettings,
  isStorageDeferred,
  setEngineDEK,
  clearEngine,
  awaitEngineStorageReady,
} from '../src/engine.js';

describe('engine module smoke tests', () => {
  it('exports expected functions', () => {
    expect(typeof setStorageProgressCallback).toBe('function');
    expect(typeof applyRuntimeSettings).toBe('function');
    expect(typeof isStorageDeferred).toBe('function');
    expect(typeof setEngineDEK).toBe('function');
    expect(typeof clearEngine).toBe('function');
    expect(typeof awaitEngineStorageReady).toBe('function');
  });
});

describe('setStorageProgressCallback', () => {
  afterEach(() => {
    setStorageProgressCallback(undefined);
  });

  it('accepts a callback function', () => {
    const cb = vi.fn();
    expect(() => setStorageProgressCallback(cb)).not.toThrow();
  });

  it('accepts undefined to clear', () => {
    setStorageProgressCallback(vi.fn());
    expect(() => setStorageProgressCallback(undefined)).not.toThrow();
  });
});

describe('applyRuntimeSettings', () => {
  it('does not throw with null config', () => {
    expect(() => applyRuntimeSettings(null)).not.toThrow();
  });

  it('does not throw with empty config', () => {
    expect(() => applyRuntimeSettings({} as any)).not.toThrow();
  });

  it('does not throw with runtime settings', () => {
    expect(() => applyRuntimeSettings({ runtime: { backgroundConcurrency: 4 } } as any)).not.toThrow();
  });
});

describe('isStorageDeferred', () => {
  beforeEach(() => {
    clearEngine();
  });

  it('returns true when engine state is null (getEngine throws)', () => {
    expect(isStorageDeferred()).toBe(true);
  });
});

describe('setEngineDEK', () => {
  beforeEach(() => {
    clearEngine();
  });

  it('does not throw when state is null', () => {
    expect(() => setEngineDEK(Buffer.alloc(32))).not.toThrow();
  });

  it('does not throw with null dek', () => {
    expect(() => setEngineDEK(null)).not.toThrow();
  });

  it('does not throw with non-32-byte dek', () => {
    expect(() => setEngineDEK(Buffer.alloc(16))).not.toThrow();
  });
});

describe('clearEngine', () => {
  it('does not throw when state is null', () => {
    expect(() => clearEngine()).not.toThrow();
  });

  it('can be called multiple times safely', () => {
    clearEngine();
    expect(() => clearEngine()).not.toThrow();
  });
});

describe('awaitEngineStorageReady', () => {
  beforeEach(() => {
    clearEngine();
  });

  it('returns a promise', () => {
    const promise = awaitEngineStorageReady();
    expect(promise).toBeInstanceOf(Promise);
    promise.catch(() => {});
  });
});
