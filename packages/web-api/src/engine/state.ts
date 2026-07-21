import {
  ConfigManager,
  type Agent,
  SessionManager,
  ProviderFactory,
  CrewManager,
  createDefaultToolkit,
  DefaultTelemetryBus,
  MemoryVectorStore,
  LLMEmbeddingProvider,
  RAGEngine,
  PluginRegistry,
  PostgresStorageAdapter,
  type Gateway,
  type TelegramBridge,
  type DiscordBridge,
  type SlackBridge,
  type EmailBridge,
  type RedisCacheRuntime,
  type WebhookNotifierRuntime,
  IntegrationHub,
  initLogCollector,
  MemoryFabric,
  healDatabaseStore,
  startPeriodicDatabaseHeal,
  resetCatalogSeedInflight,
  applyWebSearchConfigFromAgentConfig,
  setLocalModelConfig,
  applyPerformanceGovernor,
  MarkdownDocumentStore,
  setMarkdownDocumentStoreInstance,
  InMemoryQueue,
  PgBossQueue,
  registerNoOpJobWorkers,
  createServiceContext,
  ChannelService,
  type IJobQueue,
  type ServiceContext,
  getSubAgentServiceInstance,
  getPersonaStore,
} from '@agentx/engine';
import type { AgentXConfig, TelemetryBus, StorageAdapter, ChannelBindingId, ChannelSessionBinding, ClientSituation } from '@agentx/shared';
import {
  getDataDir,
  getLogger,
  resolveWorkspacePath,
  ensureBuiltinWorkspaceDir,
} from '@agentx/shared';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
// Pool type resolved via PostgresStorageAdapter's return type to avoid pg type resolution issues
import { DeferredStorageAdapter } from '../deferred-storage.js';
import { ensureChannelAgent } from './channels.js';

export interface EngineState {
  configManager: ConfigManager;
  sessionManager: SessionManager;
  agent: Agent | null;
  /** @deprecated Use channelAgents — kept for Telegram bootstrap compatibility. */
  channelAgent: Agent | null;
  /** One agent (transcript) per messaging surface: telegram, slack, discord, email. */
  channelAgents?: Map<ChannelBindingId, Agent>;
  crewManager: CrewManager;
  toolkit: ReturnType<typeof createDefaultToolkit>;
  configured: boolean;
  telemetry: TelemetryBus;
  rag: RAGEngine | null;
  pluginRegistry: PluginRegistry;
  gateway: Gateway | null;
  pgPool: ReturnType<PostgresStorageAdapter['getPool']> | null;
  connectionString: string;
  /** True until the wizard (or settings) provisions a real Postgres backend. */
  storageDeferred: boolean;
  /** Resolves when the active storage backend has finished connect + schema migration. */
  storageReady: Promise<void>;
  /** Shared job queue for durable/background tasks. */
  jobQueue: IJobQueue;
  serviceContext: ServiceContext;
  /** Active storage adapter (Postgres or deferred placeholder). */
  storageAdapter: StorageAdapter;
  telegramBridge: TelegramBridge | null;
  discordBridge: DiscordBridge | null;
  slackBridge: SlackBridge | null;
  emailBridge: EmailBridge | null;
  redisRuntime: RedisCacheRuntime | null;
  webhookRuntime: WebhookNotifierRuntime | null;
  channelSessionBindings?: Partial<Record<ChannelBindingId, ChannelSessionBinding>>;
  /** Session-scoped agents for channel inbound (does not replace the active UI agent). */
  boundSessionAgents?: Map<string, Agent>;
  /** Latest client situation from the app (location + timezone). Used by channel agents. */
  clientSituation: ClientSituation | null;
  dek: Buffer | null;
  integrationHub: IntegrationHub;
}

let state: EngineState | null = null;
/** Ensures channel bridges start once after auth unlocks encrypted config (not on every request). */
let channelsBootstrappedAfterAuth = false;
/** Optional SSE/log hook while storage connects, migrates, and seeds (setup wizard). */
let storageProgressCallback: ((line: string) => void) | undefined;

export function setStorageProgressCallback(cb: ((line: string) => void) | undefined): void {
  storageProgressCallback = cb;
}

function reportStorageProgress(line: string): void {
  storageProgressCallback?.(line);
}

function safeLoadConfig(configManager: ConfigManager): AgentXConfig | null {
  try {
    return configManager.load();
  } catch {
    return null;
  }
}

export function applyPerformanceSettings(config: AgentXConfig | null): void {
  applyPerformanceGovernor(config?.performance);
}

/** @deprecated Use applyPerformanceSettings */
export const applyRuntimeSettings = applyPerformanceSettings;

export function syncLocalModelConfig(configManager: ConfigManager): void {
  try {
    const cfg = configManager.load();
    if (cfg.localModel?.enabled && cfg.localModel.modelName && cfg.localModel.cacheDir) {
      setLocalModelConfig({
        enabled: true,
        modelId: cfg.localModel.modelId,
        modelName: cfg.localModel.modelName,
        displayName: cfg.localModel.displayName,
        cacheDir: cfg.localModel.cacheDir,
        dtype: cfg.localModel.dtype ?? 'q4',
      });
    } else {
      setLocalModelConfig(null);
    }
  } catch {
    setLocalModelConfig(null);
  }
}

export function getEngine(): EngineState {
  if (state) return state;

  const configManager = new ConfigManager();
  const configured = configManager.isConfigured();
  const loadedConfig = configured ? safeLoadConfig(configManager) : null;
  if (loadedConfig) {
    try {
      applyWebSearchConfigFromAgentConfig(loadedConfig);
    } catch { /* pre-auth or corrupt config */ }
  }

  syncLocalModelConfig(configManager);
  applyPerformanceSettings(loadedConfig);

  const initialWorkspace = loadedConfig
    ? resolveWorkspacePath(loadedConfig.workspacePath)
    : ensureBuiltinWorkspaceDir();
  const toolkit = createDefaultToolkit(initialWorkspace);
  const pluginRegistry = new PluginRegistry();
  const integrationHub = new IntegrationHub({
    getDek: () => state?.dek ?? null,
  });

  initLogCollector();

  const embeddedPgDefault = 'postgresql://agentx:agentx@127.0.0.1:3335/agentx';
  const pluginPgConnection = (() => {
    try {
      const cfg = pluginRegistry.getConfig('postgresql');
      const cs = cfg['connectionString'];
      return typeof cs === 'string' && cs.trim() ? cs.trim() : undefined;
    } catch {
      return undefined;
    }
  })();
  const pluginBackend = (() => {
    try {
      const cfg = pluginRegistry.getConfig('postgresql');
      const b = cfg['backend'];
      return b === 'embedded-postgres' || b === 'postgres' ? b : null;
    } catch {
      return null;
    }
  })();

  // Prefer runtime-provided env (embedded start or cloud preference applied at boot),
  // then the wizard/settings plugin config, then legacy config fields.
  // Do NOT fall back to embedded default when first-run deferred PG (no env, no preference).
  const resolvedFromConfig =
    process.env['AGENTX_POSTGRES_CONNECTION_STRING']
    ?? pluginPgConnection
    ?? loadedConfig?.postgres?.connectionString;

  const brainDbExists = existsSync(join(getDataDir(), 'brain_db'));
  getPersonaStore().load();
  const storageDeferred = !resolvedFromConfig
    && !pluginBackend
    && !brainDbExists
    && process.env['AGENTX_FORCE_EMBEDDED_PG'] !== '1';

  const pgConnectionString = resolvedFromConfig
    ?? (storageDeferred ? '' : embeddedPgDefault);

  if (!pgConnectionString && !storageDeferred) {
    throw new Error(
      'PostgreSQL connection string is required. When running the Agent-X desktop app, the bundled embedded PostgreSQL is started automatically. When running the web-api standalone, set AGENTX_POSTGRES_CONNECTION_STRING or configure postgres.connectionString in config.',
    );
  }

  const lazyHydrate = loadedConfig?.performance?.lazyStorageCache !== false;
  let storageAdapter: StorageAdapter;
  let pgAdapter: PostgresStorageAdapter | null = null;

  if (storageDeferred) {
    getLogger().info('STORAGE', 'Deferred storage mode — waiting for setup wizard Postgres choice');
    storageAdapter = new DeferredStorageAdapter();
  } else {
    pgAdapter = new PostgresStorageAdapter({
      connectionString: pgConnectionString,
      max: loadedConfig?.postgres?.poolSize ?? 20,
      lazyHydrate,
      onProgress: reportStorageProgress,
      connectionTimeoutMillis: 30_000,
      application_name: 'agent-x',
    });
    storageAdapter = pgAdapter;
  }

  const jobQueue: IJobQueue = pgConnectionString
    ? new PgBossQueue({
        connectionString: pgConnectionString,
        pgBossOptions: { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInHours: 23 },
      })
    : new InMemoryQueue();

  const serviceContext = createServiceContext({
    config: loadedConfig ?? ({} as AgentXConfig),
    logger: getLogger(),
    pgPool: pgAdapter?.getPool() ?? null,
    queue: jobQueue,
  });

  const sessionManager = new SessionManager({ storageAdapter });

  const storageReady = (async () => {
    if (!pgAdapter) return;
    try {
      reportStorageProgress('Connecting engine storage…');
      await pgAdapter.connect();
      const pool = pgAdapter.getPool();
      if (pool) {
        reportStorageProgress('Initializing neural memory fabric…');
        const fabric = new MemoryFabric(pool);
        await fabric.heal(reportStorageProgress);
        reportStorageProgress('Neural memory fabric ready.');
      }
      const store = sessionManager.getStorageAdapter();
      reportStorageProgress('Verifying schema and Crew Hub catalog…');
      await healDatabaseStore(store, reportStorageProgress);
      startPeriodicDatabaseHeal(store);
      reportStorageProgress('Initializing background task store…');
      const backgroundTaskStore = pgAdapter.getBackgroundTaskStore();
      getSubAgentServiceInstance().setStore(backgroundTaskStore);
      await getSubAgentServiceInstance().loadFromStore();
      reportStorageProgress('Starting durable job queue…');
      try {
        await Promise.race([
          jobQueue.start(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('job queue start timed out after 15s')), 15_000);
          }),
        ]);
      } catch (e) {
        getLogger().warn(
          'JOB_QUEUE_START',
          e instanceof Error ? e.message : String(e),
        );
        reportStorageProgress('[WARN] Durable job queue did not start — background jobs disabled.');
      }
      registerNoOpJobWorkers(jobQueue);
      reportStorageProgress('Engine storage ready.');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().error('STORAGE_READY', {
        error: message,
        stack: e instanceof Error ? e.stack : undefined,
      });
      reportStorageProgress(`[ERROR] Storage setup failed: ${message}`);
      throw e;
    }
  })();

  const store = storageDeferred ? undefined : sessionManager.getStorageAdapter();
  const crewManager = new CrewManager(store);

  const telemetry = new DefaultTelemetryBus({ enabled: true });
  telemetry.start();

  let rag: RAGEngine | null = null;
  if (configured) {
    try {
      const cfg = configManager.load();
      const providerId = cfg.provider.activeProvider;
      const providerCfg = cfg.provider.providers[providerId];
      if (providerCfg?.configured && cfg.rag?.enabled) {
        const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
        const vectorStore = new MemoryVectorStore(1536);
        const embedder = new LLMEmbeddingProvider(provider, cfg.rag.embeddingModel, 1536);
        rag = new RAGEngine(vectorStore, embedder, cfg.rag);
        void rag.storeBackend.connect();
      }
    } catch {
    }
  }

  state = {
    configManager,
    sessionManager,
    agent: null,
    channelAgent: null,
    channelAgents: new Map(),
    channelSessionBindings: {},
    crewManager,
    toolkit,
    configured,
    telemetry,
    rag,
    pluginRegistry,
    gateway: null,
    pgPool: pgAdapter?.getPool() ?? null,
    connectionString: pgConnectionString,
    storageDeferred,
    storageReady,
    jobQueue,
    serviceContext,
    storageAdapter,
    telegramBridge: null,
    discordBridge: null,
    slackBridge: null,
    emailBridge: null,
    redisRuntime: null,
    webhookRuntime: null,
    clientSituation: null,
    dek: null,
    integrationHub,
  };

  // Wire the channel service agent resolver to the engine's channel agent factory.
  if (serviceContext.channelService instanceof ChannelService) {
    serviceContext.channelService.setAgentFactory((channelId, _senderId) =>
      ensureChannelAgent(channelId as ChannelBindingId),
    );
  }

  void storageReady
    .then(async () => {
      if (!store) return;
      if (state?.pgPool) {
        setMarkdownDocumentStoreInstance(new MarkdownDocumentStore(state.pgPool));
      }
      // Ensure CrewManager is bound to the live adapter (covers deferred→ready swaps).
      if (state) state.crewManager.setStore(store);
      if (state) {
        // Rebuild roster rows lost when the async PG write queue never drained.
        const hosts = store.listSessions(500)
          .filter((s) => (s.contextKind ?? 'agent_x') === 'crew_private' && s.hostCrewId)
          .map((s) => ({
            id: s.hostCrewId!,
            name: s.hostCrewName || s.title || s.hostCrewCallsign || s.hostCrewId!,
            callsign: s.hostCrewCallsign || s.hostCrewId!,
            title: s.hostCrewTitle,
            color: s.hostCrewColor,
            catalogId: s.hostCrewCatalogId,
            source: (s.hostCrewCatalogId ? 'hub' : 'custom') as 'hub' | 'custom',
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          }));
        const restored = state.crewManager.recoverFromSessionHosts(hosts);
        if (restored > 0) {
          getLogger().info('CREW_MGR', `Recovered ${restored} missing crew(s) from session host snapshots`);
        }
        await state.crewManager.flushPersist();
      }
      await healDatabaseStore(store);
      startPeriodicDatabaseHeal(store);
      if (state) {
        state.integrationHub.setDek(state.dek);
        state.integrationHub.setToolkitBridge(state.toolkit.registry, state.toolkit.executor);
        await state.integrationHub.restoreAll();
        state.integrationHub.syncToToolkit(state.toolkit.registry, state.toolkit.executor);
      }
    })
    .catch((e) => {
      console.error('Storage connect/migrate failed; crew catalog tables may be unavailable', e);
    });

  return state!;
}

/** Whether the engine is waiting for wizard Postgres provision. */
export function isStorageDeferred(): boolean {
  try {
    return getEngine().storageDeferred;
  } catch {
    return true;
  }
}

const STORAGE_API_WAIT_MS = 8_000;

/**
 * Wait for storage without blocking API routes on pg-boss bootstrap forever.
 * After PG connect/migrate, chat/markdown can use the pool even if jobQueue.start()
 * is still running inside storageReady.
 */
export async function awaitStorageForApi(): Promise<void> {
  const eng = getEngine();
  if (eng.storageDeferred || !eng.pgPool) {
    await eng.storageReady;
    return;
  }
  await Promise.race([
    eng.storageReady,
    new Promise<void>((resolve) => setTimeout(resolve, STORAGE_API_WAIT_MS)),
  ]);
}

/** Wait until the active storage backend has finished schema migration. */
export async function awaitEngineStorageReady(): Promise<void> {
  await awaitStorageForApi();
}

/** Store the latest client situation from the app UI (location + timezone). */
export function setCurrentClientSituation(situation: ClientSituation | null): void {
  const eng = getEngine();
  eng.clientSituation = situation;
  // Sync to the active UI agent and all channel agents so every surface uses the current app location.
  if (eng.agent) eng.agent.setClientSituation(situation);
  for (const agent of eng.channelAgents?.values() ?? []) {
    agent.setClientSituation(situation);
  }
}

/** Retrieve the latest client situation recorded from the app UI. */
export function getCurrentClientSituation(): ClientSituation | null {
  return getEngine().clientSituation;
}

export function setEngineDEK(dek: Buffer | null): void {
  const normalized = dek && dek.length === 32 ? dek : null;
  if (state) {
    state.dek = normalized;
    state.configManager.setDEK(normalized);
    state.integrationHub.setDek(normalized);
    if (!normalized) {
      channelsBootstrappedAfterAuth = false;
    }
    // Update the configured flag now that the DEK is available —
    // encrypted configs become readable after auth.
    state.configured = state.configManager.isConfigured();
    try {
      if (normalized) {
        applyWebSearchConfigFromAgentConfig(state.configManager.load());
        applyPerformanceSettings(state.configManager.load());
      }
    } catch { /* not configured yet */ }

    if (normalized && !channelsBootstrappedAfterAuth) {
      void state.storageReady
        .then(async () => {
          if (!state?.dek) return;
          try {
            state.configured = state.configManager.isConfigured();
            if (!state.configured) return;
            channelsBootstrappedAfterAuth = true;
            await state.integrationHub.restoreAll();
            state.integrationHub.setToolkitBridge(state.toolkit.registry, state.toolkit.executor);
            state.integrationHub.syncToToolkit(state.toolkit.registry, state.toolkit.executor);
            const { applyChannelsConfig } = await import('../channels-sync.js');
            await applyChannelsConfig();
          } catch (error) {
            channelsBootstrappedAfterAuth = false;
            getLogger().warn('CHANNELS', error instanceof Error ? error.message : String(error));
          }
        })
        .catch((error) => {
          channelsBootstrappedAfterAuth = false;
          console.error('Integration restore after sign-in failed:', error instanceof Error ? error.message : error);
        });
    }
  }
}

/**
 * Tear down the engine. Callers that mutate durable state must
 * `await storageAdapter.flushWrites()` / `crewManager.flushPersist()` first.
 */
export function clearEngine(): void {
  if (state?.agent) {
    state.agent?.sessionLogger?.close();
    state.agent.endSession();
  }
  if (state?.channelAgents) {
    for (const agent of state.channelAgents.values()) {
      agent?.sessionLogger?.close();
      agent.endSession();
    }
    state.channelAgents.clear();
  }
  if (state?.channelAgent) {
    state.channelAgent?.sessionLogger?.close();
    state.channelAgent.endSession();
    state.channelAgent = null;
  }
  if (state?.boundSessionAgents) {
    for (const agent of state.boundSessionAgents.values()) {
      agent?.sessionLogger?.close();
      agent.endSession();
    }
    state.boundSessionAgents.clear();
  }
  state = null;
  resetCatalogSeedInflight();
}

/** Flush durable writes then clear — use when swapping storage backends. */
export async function clearEngineDurable(): Promise<void> {
  const prev = state;
  if (!prev) return;
  try {
    await prev.crewManager.flushPersist();
  } catch (e) {
    getLogger().warn('CLEAR_ENGINE', `crew flushPersist failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    if (prev.storageAdapter.flushWrites) {
      await prev.storageAdapter.flushWrites();
    }
  } catch (e) {
    getLogger().warn('CLEAR_ENGINE', `flushWrites failed: ${e instanceof Error ? e.message : e}`);
  }
  clearEngine();
  try {
    prev.storageAdapter.close?.();
  } catch { /* best-effort */ }
}
