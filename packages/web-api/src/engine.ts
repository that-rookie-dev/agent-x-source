import {
  ConfigManager,
  Agent,
  SessionManager,
  ProviderFactory,
  CrewManager,
  createDefaultToolkit,
  DockerSandbox,
  setShellSandbox,
  DefaultTelemetryBus,
  MemoryVectorStore,
  LLMEmbeddingProvider,
  RAGEngine,
  PluginRegistry,
  PostgresStorageAdapter,
  Gateway,
  TelegramBridge,
  TelegramChannelPlugin,
  DiscordBridge,
  SlackBridge,
  EmailBridge,
  RedisCacheRuntime,
  WebhookNotifierRuntime,
  SessionLogger,
  initLogCollector,
  getLogCollector,
  GrowthEngine,
  EmotionEngine,
  ExperienceEngine,
  createPgNeuralDb,
  healDatabaseStore,
  startPeriodicDatabaseHeal,
  resetCatalogSeedInflight,
  buildCrewPrivateIdentityPrompt,
  applyWebSearchConfigFromAgentConfig,
  MemoryFabric,
  setLocalModelConfig,
  IntegrationHub,
  configureBackgroundTaskPool,
  setOnnxThreadConfig,
  CanvasStore,
  setCanvasStoreInstance,
} from '@agentx/engine';
import type { AgentXConfig, ProviderId, TelemetryBus, Session, StorageAdapter } from '@agentx/shared';
import { resolveRuntimeSettings } from '@agentx/shared';
import type { PartPersistFn } from '@agentx/engine';
import { unsubscribeAgent } from './ws.js';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { getDataDir, getLogger, hydrateMessageHistoryEntries, isNeuralBrainSupported, isChannelSessionId } from '@agentx/shared';
import os from 'node:os';
import { resolveCrewPrivateHostForAgent } from './host-crew-session.js';
import { persistClarificationResumeFromAgent } from './clarification-resume.js';
import { DeferredStorageAdapter } from './deferred-storage.js';

export interface EngineState {
  configManager: ConfigManager;
  sessionManager: SessionManager;
  agent: Agent | null;
  channelAgent: Agent | null;
  crewManager: CrewManager;
  toolkit: ReturnType<typeof createDefaultToolkit>;
  configured: boolean;
  telemetry: TelemetryBus;
  rag: RAGEngine | null;
  pluginRegistry: PluginRegistry;
  gateway: Gateway | null;
  pgPool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> } | null;
  connectionString: string;
  /** True until the wizard (or settings) provisions a real Postgres backend. */
  storageDeferred: boolean;
  /** Resolves when the active storage backend has finished connect + schema migration. */
  storageReady: Promise<void>;
  telegramBridge: TelegramBridge | null;
  discordBridge: DiscordBridge | null;
  slackBridge: SlackBridge | null;
  emailBridge: EmailBridge | null;
  redisRuntime: RedisCacheRuntime | null;
  webhookRuntime: WebhookNotifierRuntime | null;
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
    ?? ((loadedConfig as any)?.postgres?.connectionString as string | undefined)
    ?? (configManager as any).getPostgresConnectionString?.();

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
      max: ((loadedConfig as any)?.postgres?.poolSize as number) ?? 5,
      lazyHydrate,
      onProgress: reportStorageProgress,
      connectionTimeoutMillis: 30_000,
    } as any);
    storageAdapter = pgAdapter;
  }

  const sessionManager = new SessionManager({ storageAdapter });

  const storageReady = (async () => {
    if (!pgAdapter) return;
    try {
      reportStorageProgress('Connecting engine storage…');
      await pgAdapter.connect();
      const pool = pgAdapter.getPool();
      if (pool) {
        reportStorageProgress('Initializing neural memory fabric…');
        const fabric = new MemoryFabric(pool as any);
        await fabric.heal(reportStorageProgress);
        reportStorageProgress('Neural memory fabric ready.');
      }
      const store = (sessionManager as any).store as PostgresStorageAdapter;
      reportStorageProgress('Verifying schema and Crew Hub catalog…');
      await healDatabaseStore(store, reportStorageProgress);
      startPeriodicDatabaseHeal(store);
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

  const store = storageDeferred ? undefined : (sessionManager as any).store as PostgresStorageAdapter;
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
    telegramBridge: null,
    discordBridge: null,
    slackBridge: null,
    emailBridge: null,
    redisRuntime: null,
    webhookRuntime: null,
    dek: null,
    integrationHub,
  };

  void storageReady
    .then(async () => {
      if (!store) return;
      if (state?.pgPool) {
        await CanvasStore.ensureSchema(state.pgPool);
        setCanvasStoreInstance(new CanvasStore(state.pgPool));
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
            const { applyChannelsConfig } = await import('./channels-sync.js');
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

export function createAgent(
  config: AgentXConfig | undefined,
  session: Session,
  options?: { attachToEngine?: boolean; automationRun?: boolean; delegatedWorker?: boolean },
): Agent {
  const eng = getEngine();
  let cfg: AgentXConfig;
  if (config) {
    cfg = config;
  } else {
    cfg = eng.configManager.load();
  }
  applyWebSearchConfigFromAgentConfig(cfg);

  if (!cfg.provider.activeProvider || !cfg.provider.activeModel) {
    throw new Error('No provider configured. Configure a provider and model first.');
  }

  const providerCfg = cfg.provider.providers[cfg.provider.activeProvider];
  if (!providerCfg?.configured) {
    throw new Error(`Provider "${cfg.provider.activeProvider}" is not fully configured. Please configure it first.`);
  }

  if (session?.scopePath) {
    eng.toolkit.executor.setScopePath(session.scopePath);
  }

  // Ensure scopePath is valid — check context.json as fallback
  const effectiveScopePath = session.scopePath
    || (() => {
        try {
          const ctxPath = join(getDataDir(), 'sessions', session.id, 'context.json');
          if (existsSync(ctxPath)) {
            const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
            return (ctx.__scopePath__ || ctx.scopePath || '') as string;
          }
        } catch { /* ignore */ }
        return '';
      })()
    || process.cwd();

  const onPart: PartPersistFn = (sessionId, part) => {
    try {
      const store = (eng.sessionManager as any).store;
      if (store && typeof store.insertPart === 'function') {
        store.insertPart(sessionId, part);
      }
    } catch { /* best effort */ }
  };

  // Load persona config from DB (brain/secret-sauce storage)
  let persona: any = null;
  try {
    const store = (eng.sessionManager as any).store;
    if (store && typeof store.getPersona === 'function') {
      persona = store.getPersona();
    }
  } catch { /* best effort */ }

  const activeModelId = cfg.provider.activeModel || (session as { modelId?: string }).modelId || '';
  const isCrewPrivate = (session.contextKind ?? 'agent_x') === 'crew_private';
  const isAgentXCore = (session.contextKind ?? 'agent_x') === 'agent_x_core';
  const isAutomationRun = (session.contextKind ?? 'agent_x') === 'automation'
    || session.id.startsWith('automation:');
  const hostCrewId = session.hostCrewId;
  const store = (eng.sessionManager as unknown as { store?: unknown }).store;
  const crewPrivateHost = isCrewPrivate && hostCrewId
    ? resolveCrewPrivateHostForAgent(eng.crewManager, session, store)
    : undefined;
  if (isCrewPrivate && hostCrewId && !crewPrivateHost) {
    throw new Error('Crew private session is missing host crew identity.');
  }

  const agent = new Agent({
    config: cfg,
    sessionId: session.id,
    systemPrompt: crewPrivateHost ? buildCrewPrivateIdentityPrompt(crewPrivateHost) : '',
    scopePath: effectiveScopePath,
    toolExecutor: eng.toolkit.executor,
    toolRegistry: eng.toolkit.registry,
    prepareIntegrationTools: async (userText) => {
      const { promptHint, accessPolicy } = await eng.integrationHub.prepareForAgentTurn(
        eng.toolkit.registry,
        eng.toolkit.executor,
        userText,
      );
      if (!promptHint && !accessPolicy) return undefined;
      return { hint: promptHint, policy: accessPolicy };
    },
    onPart,
    persona: crewPrivateHost ? null : persona,
    pgPool: state?.pgPool ?? null,
    promptProfile: crewPrivateHost ? 'crew_private' : (isAutomationRun ? 'crew_worker' : 'default'),
    crewPrivateHost,
    channelSession: isChannelSessionId(session.id),
    automationRun: isAutomationRun,
    delegatedWorker: isAutomationRun,
    contextKind: session.contextKind ?? 'agent_x',
  });

  // Apply session mode immediately so the agent starts in the correct mode
  if (isChannelSessionId(session.id)) {
    agent.setPlanMode(false);
    if (session.mode !== 'agent' || session.hyperdrive) {
      try {
        eng.sessionManager.updateSession({ mode: 'agent', hyperdrive: false } as never);
      } catch { /* best-effort */ }
    }
  } else if (isAgentXCore || session.mode === 'plan') {
    agent.setPlanMode(true);
    if (isAgentXCore && session.mode !== 'plan') {
      try {
        eng.sessionManager.updateSession({ mode: 'plan', hyperdrive: false } as never);
      } catch { /* best-effort */ }
    }
  } else {
    agent.setPlanMode(false);
  }

  const sessionCtx = Number((session as { tokenAvailable?: number }).tokenAvailable ?? 0);
  if (activeModelId && sessionCtx > 0) {
    agent.switchModel(activeModelId, sessionCtx);
  } else {
    agent.listModels().catch(() => {});
  }

  agent.setSessionManager(eng.sessionManager);

  // Initialize Docker sandbox if enabled in config
  if (cfg.useSandbox) {
    try {
      const sandbox = new DockerSandbox();
      try { sandbox.setProjectDir(session.scopePath); } catch { /* best-effort */ }
      setShellSandbox(sandbox);
      getLogger().info('SANDBOX', `Docker sandbox initialized (available: ${sandbox.available}, project-dir: ${session.scopePath})`);
    } catch (e) {
      getLogger().warn('SANDBOX', `Failed to initialize Docker sandbox: ${e instanceof Error ? e.message : e}`);
      setShellSandbox(null);
    }
  } else {
    setShellSandbox(null);
  }

  // Watchdog: auto-resume interrupted task on startup (Agent-X sessions only).
  // Skip channel super-session — it must stay idle for inbound Telegram/Slack messages.
  if (!isCrewPrivate && !isAutomationRun && !isChannelSessionId(session.id)) {
  try {
    const store = (eng.sessionManager as any).store;
    if (store && typeof store.getTaskSnapshot === 'function') {
      const snapshot = store.getTaskSnapshot(session.id) as Record<string, unknown> | null;
      if (snapshot) {
        const goal = (snapshot.goal as string) || '';
        const ageMs = Date.now() - new Date((snapshot.created_at as string) || Date.now()).getTime();
        const maxIdle = 300; // 5 min default idle threshold for auto-resume
        if (goal && ageMs < maxIdle * 1000) {
          getLogger().info('WATCHDOG', `Auto-resuming interrupted task: "${goal.slice(0, 60)}..." (idle: ${Math.round(ageMs / 1000)}s)`);
          agent.sendMessage(goal).catch((e: unknown) => {
            getLogger().warn('WATCHDOG', `Auto-resume failed: ${e instanceof Error ? e.message : e}`);
          });
        } else {
          getLogger().info('WATCHDOG', `Stale task snapshot found (${Math.round(ageMs / 1000)}s idle) — not auto-resuming`);
          store.deleteTaskSnapshot(session.id);
        }
      }
    }
  } catch { /* best-effort */ }
  }

  // Restore accumulated token count from session
  const smTracker = eng.sessionManager.getTokenTracker();
  if (smTracker) {
    (agent.tokens as any).used = smTracker.tokensUsed;
  }

  (agent.sauce as { crew: CrewManager }).crew = eng.crewManager;
  agent.sauce.crew.refresh();

  if (crewPrivateHost) {
    agent.addCrewMember(crewPrivateHost);
    agent.setCrewEnabled(crewPrivateHost.id, true);
  } else {
    const sessionCrewStates = eng.sessionManager.loadCrewStates(session.id);
    for (const state of sessionCrewStates) {
      if (!state.enabled) continue;
      const crew = eng.crewManager.get(state.crewId);
      if (crew) {
        agent.addCrewMember(crew);
        agent.setCrewEnabled(crew.id, true);
      }
    }
  }

  const crewOrch = (agent as any).crewOrchestrator;
  if (crewOrch && typeof crewOrch.setSessionManager === 'function') {
    crewOrch.setSessionManager(eng.sessionManager);
  }

  if (options?.attachToEngine !== false) {
    eng.agent = agent;
  }

  const sessionLogger = new SessionLogger(session.id);
  sessionLogger.init();
  agent.sessionLogger = sessionLogger;

  // Hook session-level logs into the global log collector
  getLogCollector().hookSessionLogger(sessionLogger);

  const dataDir = getDataDir();
  const sessDir = join(dataDir, 'sessions', session.id);
  agent.setContextPersistDir(sessDir, effectiveScopePath);

  // Wire session events to StorageAdapter (DB persistence)
  agent.onSessionEvent = (event) => {
    try {
      const store = (eng.sessionManager as any).store;
      if (store?.insertSessionEvent) {
        store.insertSessionEvent(event);
      }
    } catch { /* best-effort */ }
  };

  // Wire tool executions to StorageAdapter (DB persistence)
  try {
    const executor = (agent as any).toolExecutor;
    if (executor?.setExecutionPersist) {
      executor.setExecutionPersist((entry: { toolId: string; args: Record<string, unknown>; result: { success: boolean; output: string; error?: string }; timestamp: number; elapsed: number; sessionId: string }) => {
        try {
          eng.sessionManager.addToolExecution({
            id: crypto.randomUUID(),
            sessionId: entry.sessionId,
            toolName: entry.toolId,
            input: JSON.stringify(entry.args),
            output: entry.result.output,
            success: entry.result.success,
            elapsedMs: entry.elapsed,
          });
        } catch { /* best-effort */ }
      });
    }
  } catch { /* best-effort */ }

  // Restore recent conversation history from DB into agent memory
  try {
    const store = (eng.sessionManager as any).store;
    if (store?.getMessages) {
      const msgs = store.getMessages(session.id) as Array<{ role: string; content: string; parts?: unknown }>;
      const restorable = msgs.filter((m) =>
        m.role === 'user' || m.role === 'assistant',
      );
      const recent = restorable.slice(-24);
      const historyEntries = hydrateMessageHistoryEntries(recent);
      for (const entry of historyEntries) {
        agent.addToHistory(entry);
      }
      try {
        agent.rebuildContext();
        agent.rebuildSystemPrompt();
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }

  agent.onTokenLog = (opts) => {
    eng.sessionManager.addTokenLog({
      sessionId: session.id,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      model: cfg.provider.activeModel,
      costUsd: opts.costUsd,
      providerId: cfg.provider.activeProvider,
      crewId: opts.crewId,
    });
  };

  agent.events.on((event) => {
    const automationTaskId = isAutomationRun
      ? session.id.slice('automation:'.length)
      : undefined;
    eng.telemetry.emit({
      ...(event as Record<string, unknown>),
      sessionId: session.id,
      ...(automationTaskId ? { automationTaskId, taskId: automationTaskId } : {}),
    } as any);
    const ev = event as Record<string, unknown>;
    if (ev['type'] === 'clarification_required') {
      try {
        persistClarificationResumeFromAgent(agent, session.id);
      } catch { /* best-effort */ }
    }
    if (ev['type'] === 'token_usage') {
      const totalTokens = (ev['totalTokens'] as number) ?? 0;
      const inputTokens = (ev['inputTokens'] as number) ?? 0;
      const outputTokens = (ev['outputTokens'] as number) ?? 0;
      const contextWindow = (ev['contextWindow'] as number) ?? undefined;
      const committedUsed = inputTokens + outputTokens > 0 ? inputTokens + outputTokens : totalTokens;
      eng.sessionManager.persistSessionFields(session.id, {
        tokensUsed: committedUsed,
        ...(contextWindow ? { tokenAvailable: contextWindow } : {}),
      });
      const smTracker = (eng.sessionManager as any).tokenTracker;
      if (smTracker?.setUsed) smTracker.setUsed(totalTokens);
    }
  });

  if (!eng.gateway) {
    const gateway = new Gateway();
    eng.gateway = gateway;
  }
  if (options?.attachToEngine !== false) {
    eng.gateway!.attachAgent(agent);
  }

  // Channel-bridge wiring runs only for the primary UI agent — not the dedicated __channel__ agent
  // (ensureChannelAgent uses attachToEngine: false to avoid recursive ensureChannelAgent ↔ createAgent).
  if (options?.attachToEngine !== false) {
  // Telegram inbound is started by applyChannelsConfig() after auth — not from createAgent.
  const tgPlugin = eng.pluginRegistry.getPlugin('telegram');
  const tgConfig = tgPlugin?.config ?? {};
  if (eng.gateway && tgPlugin?.enabled && tgConfig['botToken']) {
    try {
      const channelAgent = ensureChannelAgent();
      const entry = (eng.gateway as unknown as { registry?: { getChannel?: (id: string) => { plugin?: TelegramChannelPlugin } | null } }).registry?.getChannel?.('telegram');
      const plugin = entry?.plugin;
      if (plugin && 'setAgent' in plugin) {
        plugin.setAgent(channelAgent);
        plugin.setChatIdPersister?.((id: string) => {
          try {
            const c = eng.configManager.load();
            if (c.channels?.telegram?.chatId === id) return;
            eng.configManager.save({
              ...c,
              channels: { ...c.channels, telegram: { ...c.channels?.telegram, chatId: id } },
            });
          } catch { /* best-effort */ }
        });
      }
    } catch { /* best-effort */ }
  }

  const dcPlugin = eng.pluginRegistry.getPlugin('discord');
  const dcConfig = dcPlugin?.config ?? {};
  if (dcPlugin?.enabled && dcConfig['botToken'] && !eng.discordBridge) {
    try {
      const bridge = new DiscordBridge();
      bridge.setAgentFactory(async () => {
        const userCfg = eng.configManager.load();
        const userProvider = userCfg.provider.activeProvider as ProviderId;
        const userSession = eng.sessionManager.createSession(
          userProvider,
          userCfg.provider.activeModel,
          process.cwd(),
        );
        return new Agent({
          config: userCfg,
          sessionId: userSession.id,
          systemPrompt: '',
          scopePath: userSession.scopePath,
          toolExecutor: eng.toolkit.executor,
          toolRegistry: eng.toolkit.registry,
        });
      });
      bridge.start(dcConfig['botToken'] as string, dcConfig['channelId'] as string | undefined).then(() => {
        eng.discordBridge = bridge;
      }).catch((e: unknown) => {
        console.error('Failed to start Discord bridge', e);
      });
    } catch (e) {
      console.error('Failed to start Discord bridge', e);
    }
  }

  const slPlugin = eng.pluginRegistry.getPlugin('slack');
  const slConfig = slPlugin?.config ?? {};
  if (slPlugin?.enabled && slConfig['botToken'] && slConfig['appToken'] && !eng.slackBridge) {
    try {
      const bridge = new SlackBridge({
        botToken: slConfig['botToken'] as string,
        appToken: slConfig['appToken'] as string,
      });
      bridge.setAgentFactory((_userId: string) => {
        const userCfg = eng.configManager.load();
        const userSession = eng.sessionManager.createSession(
          userCfg.provider.activeProvider,
          userCfg.provider.activeModel,
          process.cwd(),
        );
        return new Agent({
          config: userCfg,
          sessionId: userSession.id,
          systemPrompt: '',
          scopePath: userSession.scopePath,
          toolExecutor: eng.toolkit.executor,
          toolRegistry: eng.toolkit.registry,
        });
      });
      bridge.start().then(() => {
        eng.slackBridge = bridge;
      }).catch((e: unknown) => {
        console.error('Failed to start Slack bridge', e);
      });
    } catch (e) {
      console.error('Failed to start Slack bridge', e);
    }
  }

  const emPlugin = eng.pluginRegistry.getPlugin('email');
  const emConfig = emPlugin?.config ?? {};
  if (emPlugin?.enabled && emConfig['smtpHost'] && !eng.emailBridge) {
    try {
      const bridge = new EmailBridge();
      bridge.setAgentDeps({
        config: cfg,
        systemPrompt: '',
        toolExecutor: eng.toolkit.executor,
        toolRegistry: eng.toolkit.registry,
      });
      bridge.start({
        smtpHost: String(emConfig['smtpHost']),
        smtpPort: Number(emConfig['smtpPort'] ?? 587),
        smtpUser: String(emConfig['smtpUser']),
        smtpPass: String(emConfig['smtpPass']),
        fromAddress: String(emConfig['fromAddress'] ?? emConfig['smtpUser']),
        imapHost: emConfig['imapHost'] ? String(emConfig['imapHost']) : undefined,
        imapPort: emConfig['imapPort'] ? Number(emConfig['imapPort']) : undefined,
      }).then(() => {
        eng.emailBridge = bridge;
      }).catch((e: unknown) => {
        console.error('Failed to start Email bridge', e);
      });
    } catch (e) {
      console.error('Failed to start Email bridge', e);
    }
  }
  }

  if (!eng.redisRuntime) {
    const redisPlugin = eng.pluginRegistry.getPlugin('redis-cache');
    const redisConfig = redisPlugin?.config ?? {};
    if (redisPlugin?.enabled) {
      eng.redisRuntime = new RedisCacheRuntime({
        url: redisConfig['url'] as string,
        ttl: (redisConfig['ttl'] as number) || 300000,
      });
    }
  }

  if (!eng.webhookRuntime) {
    const whPlugin = eng.pluginRegistry.getPlugin('webhook-notifier');
    const whConfig = whPlugin?.config ?? {};
    if (whPlugin?.enabled && whConfig['url']) {
      eng.webhookRuntime = new WebhookNotifierRuntime({
        url: whConfig['url'] as string,
        events: whConfig['events'] as string[],
        secret: whConfig['secret'] as string,
      });
      agent.events.on((event) => {
        const e = event as unknown as { type?: string; [key: string]: unknown };
        if (e.type && eng.webhookRuntime) {
          void eng.webhookRuntime.notify(e.type, e as Record<string, unknown>);
        }
      });
    }
  }

  rewireTelegramChannelPermissions(eng);

  return agent;
}

/** Restore Telegram inline permission prompts after the shared executor handler was replaced. */
export function rewireTelegramChannelPermissions(eng?: ReturnType<typeof getEngine>): void {
  try {
    const e = eng ?? getEngine();
    const entry = (e.gateway as { registry?: { getChannel?: (id: string) => { plugin?: unknown } | null } } | null)
      ?.registry?.getChannel?.('telegram');
    const plugin = entry?.plugin as { rewirePermissionHandling?: () => void } | undefined;
    plugin?.rewirePermissionHandling?.();

    const channelExec = e.channelAgent?.getToolExecutor?.();
    if (channelExec && e.toolkit.executor?.copyExecutionPolicyFrom) {
      e.toolkit.executor.copyExecutionPolicyFrom(channelExec);
    }
  } catch { /* best-effort */ }
}

export function getOrCreateAgent(config?: AgentXConfig, session?: Session): Agent {
  const eng = getEngine();
  if (eng.agent && !config) return eng.agent;
  if (!session) {
    const sess = eng.sessionManager.getActiveSession();
    if (!sess) throw new Error('No active session. Create a session first.');
    return createAgent(config, sess);
  }
  return createAgent(config, session);
}

/** Align the channel super-session agent with the active UI workspace and crew roster. */
export function syncChannelSuperSessionContext(eng?: ReturnType<typeof getEngine>): void {
  const e = eng ?? getEngine();
  const channelAgent = e.channelAgent as Agent | null | undefined;
  if (!channelAgent) return;

  const active = e.sessionManager.getActiveSession()
    ?? (e.agent?.currentSessionId && e.agent.currentSessionId !== '__channel__'
      ? e.sessionManager.getSessionById(e.agent.currentSessionId)
      : null);

  if (active?.scopePath) {
    channelAgent.setScopePath(active.scopePath);
  }

  if (active?.id) {
    const crewStates = e.sessionManager.loadCrewStates(active.id);
    if (crewStates.length > 0) {
      const signature = crewStates.map((s) => `${s.crewId}:${s.enabled ? 1 : 0}`).sort().join(',');
      const prev = (channelAgent as unknown as { __crewSyncSig?: string }).__crewSyncSig;
      if (signature !== prev) {
        (channelAgent as unknown as { __crewSyncSig?: string }).__crewSyncSig = signature;
        channelAgent.restoreCrewStates(crewStates);
      }
    } else if (e.agent && e.agent !== channelAgent) {
      const enabled = e.agent.getActiveCrewMembers().map((m) => ({
        crewId: m.crew.id,
        enabled: true,
      }));
      if (enabled.length > 0) channelAgent.restoreCrewStates(enabled);
    }
  }
}

export function ensureChannelAgent(): Agent {
  const eng = getEngine();
  if (eng.channelAgent) return eng.channelAgent;

  const cfg = eng.configManager.load();

  const CHANNEL_SESSION_ID = '__channel__';
  let session = eng.sessionManager.restoreSession(CHANNEL_SESSION_ID);
  if (!session) {
    session = eng.sessionManager.createSession(
      cfg.provider.activeProvider as ProviderId,
      cfg.provider.activeModel,
      process.cwd(),
      CHANNEL_SESSION_ID,
    );
  } else if (session.mode !== 'agent' || session.hyperdrive) {
    try {
      eng.sessionManager.updateSession({ mode: 'agent', hyperdrive: false } as never);
      session.mode = 'agent';
      session.hyperdrive = false;
    } catch { /* best-effort */ }
  }

  const agent = createAgent(cfg, session, { attachToEngine: false });
  eng.channelAgent = agent;
  return agent;
}

export function destroyAgent(): void {
  const eng = getEngine();
  unsubscribeAgent();
  if (eng.agent) {
    (eng.agent as any).sessionLogger?.close();
    eng.agent.endSession();
    eng.agent = null;
  }
}

export function clearEngine(): void {
  if (state?.agent) {
    (state.agent as any).sessionLogger?.close();
    state.agent.endSession();
  }
  if (state?.channelAgent) {
    (state.channelAgent as any).sessionLogger?.close();
    state.channelAgent.endSession();
    state.channelAgent = null;
  }
  state = null;
  resetCatalogSeedInflight();
}

export async function getVitals(): Promise<Record<string, unknown>> {
  try {
    const eng = getEngine();
    const pool = eng.pgPool;
    if (!pool) {
      return { status: 'uninitialized', ageDays: 0, level: 'Fresh', wisdomScore: 0, totalExperiences: 0, totalInteractions: 0, totalCorrections: 0, avgConfidence: 0, currentMood: 'neutral', moodIntensity: 0.3, memories: { total: 0, categories: {} }, diaryEntries: 0, brainSizeFormatted: '0 B', nextMilestoneAt: null, capabilities: [], birthDate: null };
    }

    const neuralDb = createPgNeuralDb(pool);
    const growth = new GrowthEngine(neuralDb);
    const emotion = new EmotionEngine(neuralDb);
    const experience = new ExperienceEngine(neuralDb);

    const growthState = growth.getCurrentState();
    const emotionState = emotion.getCurrentState();
    const ageDays = growth.getAgeDays();

    let memoriesTotal = 0;
    const memoryCategories: Record<string, number> = {};
    try {
      const memRes = await pool.query('SELECT category, COUNT(*) as c FROM agent_memories GROUP BY category');
      for (const row of memRes.rows) {
        const category = row['category'] as string;
        const count = Number(row['c'] ?? 0);
        if (category) memoryCategories[category] = count;
        memoriesTotal += count;
      }
    } catch { /* table may not exist yet */ }

    let diaryEntries = 0;
    try {
      const diaryRes = await pool.query('SELECT COUNT(*) as c FROM agent_diary');
      diaryEntries = Number(diaryRes.rows[0]?.['c'] ?? 0);
    } catch { /* */ }

    let birthDate: string | null = null;
    try {
      const sources = await Promise.all([
        pool.query('SELECT MIN(created_at) as d FROM agent_experiences').catch(() => ({ rows: [] })),
        pool.query('SELECT MIN(created_at) as d FROM agent_memories').catch(() => ({ rows: [] })),
        pool.query('SELECT MIN(created_at) as d FROM agent_diary').catch(() => ({ rows: [] })),
      ]);
      const dates = sources
        .map((r) => r.rows[0]?.['d'] as string | null | undefined)
        .filter((d): d is string => !!d);
      if (dates.length > 0) birthDate = dates.sort()[0] ?? null;
    } catch { /* */ }

    let capabilities: string[] = [];
    if (growthState?.capabilities) {
      try { capabilities = JSON.parse(growthState.capabilities); } catch { capabilities = []; }
    }

    let brainSizeFormatted = 'PG';
    try {
      const sizeRes = await pool.query('SELECT pg_database_size(current_database()) as bytes');
      const bytes = Number(sizeRes.rows[0]?.['bytes'] ?? 0);
      brainSizeFormatted = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
    } catch { /* */ }

    return {
      status: 'initialized',
      ageDays,
      birthDate,
      level: growthState?.level ?? 'Fresh',
      wisdomScore: growthState?.wisdomScore ?? 0,
      totalExperiences: experience.getTotalCount(),
      totalInteractions: growthState?.totalInteractions ?? 0,
      totalCorrections: experience.getCorrectionCount(),
      avgConfidence: experience.getAverageConfidence(),
      currentMood: emotionState?.currentMood ?? 'neutral',
      moodIntensity: emotionState?.moodIntensity ?? 0.3,
      memories: { total: memoriesTotal, categories: memoryCategories },
      diaryEntries,
      brainSizeFormatted,
      nextMilestoneAt: growthState?.nextMilestoneAt ?? null,
      capabilities,
    };
  } catch (e) {
    getLogger().error('GET_VITALS', e instanceof Error ? e : String(e));
    return { status: 'uninitialized', ageDays: 0, level: 'Fresh', wisdomScore: 0, totalExperiences: 0, totalInteractions: 0, totalCorrections: 0, avgConfidence: 0, currentMood: 'neutral', moodIntensity: 0.3, memories: { total: 0, categories: {} }, diaryEntries: 0, brainSizeFormatted: '0 B', nextMilestoneAt: null, capabilities: [], birthDate: null };
  }
}

/**
 * Aggregate autonomy status for the Health panel observability.
 * Combines circuit breaker status, neural context, memory-driven suggestions,
 * escalation state, hallucination guardrail, offline fallback, and compaction details.
 */
export function getAutonomyStatus(): Record<string, unknown> {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) return { available: false };

    const health = agent.getHealth();

    // Circuit breaker details
    const executor = agent.getToolExecutor();
    let circuitBreakers: Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }> = [];
    if (executor && typeof (executor as any).getCircuitBreakerStatus === 'function') {
      circuitBreakers = (executor as any).getCircuitBreakerStatus();
    }

    // Neural context
    let provenContext = '';
    let cautionContext = '';
    let growthContext = '';
    try {
      const expEngine = (agent as any).experienceEngineInstance;
      if (expEngine) {
        provenContext = expEngine.getProvenContext?.() ?? '';
        cautionContext = expEngine.getCautionContext?.() ?? '';
      }
      const growEngine = (agent as any).growthEngineInstance;
      if (growEngine) {
        growthContext = growEngine.getGrowthContext?.() ?? '';
      }
    } catch { /* */ }

    // Memory-driven approach
    let memoryDrivenContext = '';
    try {
      const rl = (agent as any).reflectionLoopInstance;
      if (rl && typeof rl.getBestApproach === 'function') {
        memoryDrivenContext = rl.getBestApproach?.('current task') ?? '';
      }
    } catch { /* */ }

    // Escalation state — active checkpoints
    let activeCheckpoints = 0;
    let checkpointDetails: Array<{ description: string; checkpointId: string }> = [];
    try {
      const pendingCkp = (agent as any)._pendingCheckpoint;
      if (pendingCkp) {
        activeCheckpoints = 1;
        checkpointDetails = [{ description: 'Active checkpoint awaiting user input', checkpointId: pendingCkp.checkpointId }];
      }
      const ckpCounts = (agent as any)._checkpointCounts as Map<string, number> | undefined;
      if (ckpCounts && ckpCounts.size > 0) {
        for (const [stepKey, count] of ckpCounts) {
          if (count >= 2) {
            checkpointDetails.push({ description: `Stuck: "${stepKey.slice(0, 60)}" (${count} failures)`, checkpointId: 'escalated' });
          }
        }
      }
    } catch { /* */ }

    // Offline fallback status
    let offlineFallback = { available: false, provider: '', model: '' };
    try {
      const fb = (agent as any)._fallbackProvider;
      if (fb) {
        offlineFallback = { available: fb.available, provider: fb.id ?? '', model: fb.model ?? '' };
      }
    } catch { /* */ }

    // DB backend mode
    const dbMode = 'postgres';

    // Compaction stats
    const compactionCount = health.compactionCount;
    const tokenUsagePct = health.contextWindow > 0 ? Math.round((health.contextTokens / health.contextWindow) * 100) : 0;

    return {
      available: true,
      health,
      circuitBreakers,
      neural: { proven: provenContext, caution: cautionContext, growth: growthContext },
      memoryDriven: memoryDrivenContext,
      escalation: {
        activeCheckpoints,
        checkpointDetails,
      },
      offlineFallback,
      dbMode,
      compaction: {
        count: compactionCount,
        contextTokens: health.contextTokens,
        contextWindow: health.contextWindow,
        tokenUsagePct,
      },
    };
  } catch {
    return { available: false };
  }
}
