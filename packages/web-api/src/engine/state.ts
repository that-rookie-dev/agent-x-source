import {
  ConfigManager,
  type Agent,
  SessionManager,
  ProviderFactory,
  CrewManager,
  createDefaultToolkit,
  DefaultTelemetryBus,
  initObservability,
  type ObservabilityHandle,
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
  ArticleStore,
  setArticleStoreInstance,
  initRuntimeCapabilityManager,
  InMemoryQueue,
  PgBossQueue,
  registerNoOpJobWorkers,
  createServiceContext,
  ChannelService,
  type IJobQueue,
  type ServiceContext,
  getSubAgentServiceInstance,
  getPersonaStore,
  GeoLocationService,
  setGeoLocationServiceInstance,
  registerClientSituationSetter,
  registerClientSituationGetter,
  startAppSpan,
  channelMetricSource,
  setDbMetricsSink,
  setSpanMetricsSink,
  type AgentMetricsApi,
  setAdoptionDbPool,
  runAdoptionStartupSweeps,
  RuntimeCapabilityManager,
  getRuntimeCapabilityManager,
  setRuntimeCapabilityManager,
} from '@agentx/engine';
import type { AgentXConfig, TelemetryBus, StorageAdapter, ChannelBindingId, ChannelSessionBinding, ClientSituation } from '@agentx/shared';
import {
  configureAdoptionFromConfig,
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
import { metricsRegistry } from '../metrics/MetricsRegistry.js';

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
  observabilityHandle?: ObservabilityHandle;
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
  /** WhatsApp session lifecycle service (null until WhatsApp is enabled + linked). */
  whatsappSessionService: import('@agentx/engine').WhatsAppSessionService | null;
  redisRuntime: RedisCacheRuntime | null;
  webhookRuntime: WebhookNotifierRuntime | null;
  channelSessionBindings?: Partial<Record<ChannelBindingId, ChannelSessionBinding>>;
  /** Session-scoped agents for channel inbound (does not replace the active UI agent). */
  boundSessionAgents?: Map<string, Agent>;
  /** Latest client situation from the app (location + timezone). Used by channel agents. */
  clientSituation: ClientSituation | null;
  /** Server-side geolocation service (IP-based, refreshes every 15 min). */
  geoLocationService: GeoLocationService | null;
  dek: Buffer | null;
  integrationHub: IntegrationHub;
}

let state: EngineState | null = null;
/** Ensures channel bridges start once after auth unlocks encrypted config (not on every request). */
let channelsBootstrappedAfterAuth = false;
/** Optional SSE/log hook while storage connects, migrates, and seeds (setup wizard). */
let storageProgressCallback: ((line: string) => void) | undefined;

/** Active SI manager, or null while not yet initialized. */
let siManager: RuntimeCapabilityManager | null = null;
/** In-flight SI manager init promise so multiple callers share one attempt. */
let siInitPromise: Promise<RuntimeCapabilityManager | null> | null = null;

/**
 * Adapter that exposes the web-api {@link ApiService.getAgentMetrics} values to
 * the engine's {@link AgentMetricsApi} (used by the observability MetricsSampler
 * to publish AGENT-domain metrics). Set from `index.ts` immediately after the
 * ApiService is created, before `storageReady` resolves and `initObservability`
 * runs, so the agent metric source is wired at init time (§8.2).
 */
let agentMetricsApi: AgentMetricsApi | null = null;

export function setAgentMetricsApi(api: AgentMetricsApi): void {
  agentMetricsApi = api;
}

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

export function applyAdoptionSettings(config: AgentXConfig | null): void {
  configureAdoptionFromConfig(config);
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
  applyAdoptionSettings(loadedConfig);

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

  function isEmbeddedPgConnectionString(conn: string): boolean {
    return /(?:127\.0\.0\.1|localhost):3335\b/.test(conn);
  }
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
    const embeddedPg = isEmbeddedPgConnectionString(pgConnectionString);
    const defaultPoolMax = embeddedPg ? 6 : 20;
    if (embeddedPg && !process.env['AGENTX_OBS_PG_POOL_SIZE']) {
      process.env['AGENTX_OBS_PG_POOL_SIZE'] = '1';
    }
    pgAdapter = new PostgresStorageAdapter({
      connectionString: pgConnectionString,
      max: loadedConfig?.postgres?.poolSize ?? defaultPoolMax,
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
        setAdoptionDbPool(pool);
        void runAdoptionStartupSweeps().catch((e) => {
          getLogger().warn('ADOPTION_STARTUP', e instanceof Error ? e.message : String(e));
        });
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
    whatsappSessionService: null,
    redisRuntime: null,
    webhookRuntime: null,
    clientSituation: null,
    geoLocationService: null,
    dek: null,
    integrationHub,
  };

  // Legacy server IP geolocation — no longer drives client situation (client UI is authoritative).
  const geoService = new GeoLocationService({
    onUpdate: () => { /* client pushes location via POST /api/client-situation */ },
  });
  state.geoLocationService = geoService;
  setGeoLocationServiceInstance(geoService);

  registerClientSituationSetter((situation) => setCurrentClientSituation(situation));
  registerClientSituationGetter(() => getCurrentClientSituation());

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
        setArticleStoreInstance(new ArticleStore(state.pgPool));
        await ensureSiManager().catch((err) => {
          getLogger().warn('SI_INIT', err instanceof Error ? err.message : String(err));
        });
      }
      // Ensure CrewManager is bound to the live adapter (covers deferred→ready swaps).
      if (state) state.crewManager.setStore(store);
      if (state) {
        // Rebuild *custom* roster rows lost when the async PG write queue never drained.
        // Hub hosts are ignored inside recoverFromSessionHosts (catalog re-recruit instead).
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
      if (state && pgAdapter) {
        try {
          // Bridge DB query metrics from the engine's PostgresStorageAdapter
          // instrumentation into the web-api MetricsRegistry so they show up
          // in the /metrics endpoint and are persisted via the sampler.
          setDbMetricsSink({
            incrementCounter: (name, labels, value) => metricsRegistry.incrementCounter(name, labels, value),
            recordHistogram: (name, labels, valueSeconds) => metricsRegistry.recordHistogram(name, labels, valueSeconds),
          });
          // Bridge span-derived metrics (tokens, cost, tool calls, turn
          // duration) from the PostgresSpanExporter into the web-api
          // MetricsRegistry so the Prometheus `/api/metrics` endpoint and the
          // MetricsSampler both see them (§8.2).
          setSpanMetricsSink({
            incrementCounter: (name, labels, value) => metricsRegistry.incrementCounter(name, labels, value),
            recordHistogram: (name, labels, valueSeconds) => metricsRegistry.recordHistogram(name, labels, valueSeconds),
          });
          state.observabilityHandle = await initObservability(pgAdapter.getPool()!, {
            telemetryBus: state.telemetry,
            // AGENT-domain metrics (turns, tool latency, queue depth, cache hit
            // rate) sourced from the ApiService adapter set via
            // `setAgentMetricsApi` in index.ts (§8.2).
            api: agentMetricsApi ?? undefined,
            metricSources: [
              // Expose web-api MetricsRegistry counters/histograms/gauges to the
              // MetricsSampler so APP-domain metrics are persisted to the
              // observability.database alongside AGENT-domain metrics.
              {
                name: 'web-api-registry',
                snapshot: () => metricsRegistry.snapshot(),
              },
              // Channel event counters (discord/slack/telegram/whatsapp) from
              // the engine package's in-memory channel-metrics module.
              channelMetricSource,
            ],
          });
        } catch (e) {
          getLogger().error('OBSERVABILITY_INIT', e instanceof Error ? e.message : String(e));
        }
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
      siManager = null;
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
 * After PG connect/migrate, chat/articles can use the pool even if jobQueue.start()
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

async function loadSiManager(eng: EngineState): Promise<RuntimeCapabilityManager | null> {
  if (eng.storageDeferred) {
    await eng.storageReady.catch(() => {});
  }
  if (!eng.pgPool) return null;
  let configured = false;
  try {
    configured = eng.configManager.isConfigured();
  } catch {
    configured = false;
  }
  if (!configured) return null;
  try {
    const cfg = eng.configManager.load();
    const mgr = await initRuntimeCapabilityManager({
      pool: eng.pgPool,
      config: cfg,
      toolkit: { registry: eng.toolkit.registry, executor: eng.toolkit.executor },
    });
    const { attachCapabilityEventBridge } = await import('../capability-events.js');
    attachCapabilityEventBridge();
    // Only adopt this manager if the engine hasn't been swapped out from under us.
    if (state === eng) siManager = mgr;
    return mgr;
  } catch (err) {
    getLogger().warn('SI_INIT', err instanceof Error ? err.message : String(err));
    const fallback = getRuntimeCapabilityManager();
    if (state === eng) siManager = fallback;
    return fallback;
  }
}

/**
 * Return the current SI manager, initializing it on demand if storage is ready.
 * Multiple callers share one in-flight init attempt.
 */
export async function ensureSiManager(): Promise<RuntimeCapabilityManager | null> {
  if (siManager) return siManager;
  if (siInitPromise) return siInitPromise;
  const eng = getEngine();
  siInitPromise = loadSiManager(eng).finally(() => {
    siInitPromise = null;
  });
  return siInitPromise;
}

/**
 * Wait for the RuntimeCapabilityManager to finish initialization after storage is ready.
 * Returns null if there is no pool or init failed.
 */
export async function awaitSiManager(): Promise<RuntimeCapabilityManager | null> {
  await awaitStorageForApi();
  return ensureSiManager();
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
  eng.telemetry.emit({
    type: 'agent_action',
    timestamp: new Date().toISOString(),
    metadata: { action: 'client_situation_updated' },
  });
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
    if (state.configured) {
      void ensureSiManager().catch(() => {});
    }
    try {
      if (normalized) {
        applyWebSearchConfigFromAgentConfig(state.configManager.load());
        applyPerformanceSettings(state.configManager.load());
        applyAdoptionSettings(state.configManager.load());
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
            const { applyHostConfig } = await import('../host/apply-host-config.js');
            await applyHostConfig(state.configManager.load());
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
  const shutdownRoot = startAppSpan('app.shutdown', 'shutdown', 'app_shutdown');
  const shutdownStart = Date.now();

  // shutdown.engine — end all agent sessions
  const enginePhase = startAppSpan('shutdown.engine', 'shutdown', 'shutdown_engine');
  const engineStart = Date.now();
  try {
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
  } catch (e) {
    enginePhase.span.recordError(`Engine teardown failed: ${e instanceof Error ? e.message : e}`);
  }
  enginePhase.span.setAttribute('startup.phase', 'shutdown.engine');
  enginePhase.span.setAttribute('startup.duration_ms', Date.now() - engineStart);
  enginePhase.span.end();

  // shutdown.observability — best-effort observability flush marker
  const obsPhase = startAppSpan('shutdown.observability', 'shutdown', 'shutdown_observability');
  const obsStart = Date.now();
  obsPhase.span.setAttribute('startup.phase', 'shutdown.observability');
  obsPhase.span.setAttribute('startup.duration_ms', Date.now() - obsStart);
  obsPhase.span.end();

  shutdownRoot.span.setAttribute('shutdown.duration_ms', Date.now() - shutdownStart);
  shutdownRoot.span.end();
  metricsRegistry.incrementCounter('app_shutdowns_total', {}, 1);
}

/** Flush durable writes then clear — use when swapping storage backends. */
export async function clearEngineDurable(): Promise<void> {
  const prev = state;
  if (!prev) return;

  const shutdownRoot = startAppSpan('app.shutdown', 'shutdown', 'app_shutdown');
  const shutdownStart = Date.now();

  // shutdown.engine — flush durable writes
  const enginePhase = startAppSpan('shutdown.engine', 'shutdown', 'shutdown_engine');
  const engineStart = Date.now();
  try {
    await prev.crewManager.flushPersist();
  } catch (e) {
    getLogger().warn('CLEAR_ENGINE', `crew flushPersist failed: ${e instanceof Error ? e.message : e}`);
    enginePhase.span.recordError(`crew flushPersist failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    if (prev.storageAdapter.flushWrites) {
      await prev.storageAdapter.flushWrites();
    }
  } catch (e) {
    getLogger().warn('CLEAR_ENGINE', `flushWrites failed: ${e instanceof Error ? e.message : e}`);
    enginePhase.span.recordError(`flushWrites failed: ${e instanceof Error ? e.message : e}`);
  }
  enginePhase.span.setAttribute('startup.phase', 'shutdown.engine');
  enginePhase.span.setAttribute('startup.duration_ms', Date.now() - engineStart);
  enginePhase.span.end();

  // shutdown.ws — no WebSocket in state.ts, but mark the phase for completeness
  const wsPhase = startAppSpan('shutdown.ws', 'shutdown', 'shutdown_ws');
  const wsStart = Date.now();
  wsPhase.span.setAttribute('startup.phase', 'shutdown.ws');
  wsPhase.span.setAttribute('startup.duration_ms', Date.now() - wsStart);
  wsPhase.span.end();

  // shutdown.observability — close storage adapter (observability flush)
  const obsPhase = startAppSpan('shutdown.observability', 'shutdown', 'shutdown_observability');
  const obsStart = Date.now();
  try {
    prev.storageAdapter.close?.();
  } catch (e) {
    obsPhase.span.recordError(`storageAdapter.close failed: ${e instanceof Error ? e.message : e}`);
  }
  obsPhase.span.setAttribute('startup.phase', 'shutdown.observability');
  obsPhase.span.setAttribute('startup.duration_ms', Date.now() - obsStart);
  obsPhase.span.end();

  // Now clear in-memory state (without re-entering the span wrapper).
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
  siManager = null;
  siInitPromise = null;
  setRuntimeCapabilityManager(null);
  resetCatalogSeedInflight();

  shutdownRoot.span.setAttribute('shutdown.duration_ms', Date.now() - shutdownStart);
  shutdownRoot.span.end();
  metricsRegistry.incrementCounter('app_shutdowns_total', {}, 1);
}
