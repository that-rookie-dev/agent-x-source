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
  configureBackgroundTaskPool,
  setOnnxThreadConfig,
  MarkdownDocumentStore,
  setMarkdownDocumentStoreInstance,
  InMemoryQueue,
  PgBossQueue,
  registerNoOpJobWorkers,
  createServiceContext,
  ChannelService,
  type IJobQueue,
  type ServiceContext,
} from '@agentx/engine';
import type { AgentXConfig, TelemetryBus, StorageAdapter, ChannelBindingId, ChannelSessionBinding, ClientSituation } from '@agentx/shared';
import { resolveRuntimeSettings, getDataDir, getLogger, isNeuralBrainSupported } from '@agentx/shared';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';
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

/** Disable neural brain on machines below the RAM threshold (saves memory and background work). */
function applyLowRamFeatureDefaults(configManager: ConfigManager): void {
  const ramGb = os.totalmem() / (1024 ** 3);
  if (isNeuralBrainSupported(ramGb)) return;
  try {
    const cfg = configManager.load();
    if (cfg.neuralBrain === false) return;
    configManager.save({ ...cfg, neuralBrain: false });
    getLogger().info('SYSTEM', `Neural brain auto-disabled — ${ramGb.toFixed(1)} GB RAM (requires 16 GB+)`);
  } catch { /* config not ready yet */ }
}

export function applyRuntimeSettings(config: AgentXConfig | null): void {
  const resolved = resolveRuntimeSettings(config?.runtime);
  configureBackgroundTaskPool(resolved.backgroundConcurrency);
  setOnnxThreadConfig(resolved.onnxIntraOpThreads, resolved.onnxInterOpThreads);
}

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
  applyRuntimeSettings(loadedConfig);

  applyLowRamFeatureDefaults(configManager);

  const toolkit = createDefaultToolkit(process.cwd());
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

  const lazyHydrate = loadedConfig?.runtime?.lazyStorageCache !== false;
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
      reportStorageProgress('Starting durable job queue…');
      await jobQueue.start();
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
        await MarkdownDocumentStore.ensureSchema(state.pgPool);
        setMarkdownDocumentStoreInstance(new MarkdownDocumentStore(state.pgPool));
      }
      if (state) state.crewManager.refresh();
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

/** Wait until the active storage backend has finished schema migration. */
export async function awaitEngineStorageReady(): Promise<void> {
  const eng = getEngine();
  await eng.storageReady;
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
        applyRuntimeSettings(state.configManager.load());
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
