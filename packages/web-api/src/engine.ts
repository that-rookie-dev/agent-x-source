import {
  ConfigManager,
  Agent,
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
  Gateway,
  TelegramBridge,
  DiscordBridge,
  SlackBridge,
  EmailBridge,
  RedisCacheRuntime,
  WebhookNotifierRuntime,
  SQLiteBrowserRuntime,
  MCPBridge,
  SessionLogger,
} from '@agentx/engine';
import type { AgentXConfig, ProviderId, TelemetryBus } from '@agentx/shared';
import { unsubscribeAgent } from './ws.js';
import { join } from 'node:path';
import { getDataDir } from '@agentx/shared';

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
  telegramBridge: TelegramBridge | null;
  discordBridge: DiscordBridge | null;
  slackBridge: SlackBridge | null;
  emailBridge: EmailBridge | null;
  redisRuntime: RedisCacheRuntime | null;
  webhookRuntime: WebhookNotifierRuntime | null;
  sqliteBrowser: SQLiteBrowserRuntime | null;
  mcpBridge: MCPBridge;
  dek: Buffer | null;
}

let state: EngineState | null = null;
let pendingCwd: string | null = null;

export function setPendingCwd(cwd: string | null): void { pendingCwd = cwd; }
export function getPendingCwd(): string | null { return pendingCwd; }

function safeLoadConfig(configManager: ConfigManager): void {
  try {
    configManager.load();
  } catch {
    // not configured yet
  }
}

export function getEngine(): EngineState {
  if (state) return state;

  const configManager = new ConfigManager();
  const configured = configManager.isConfigured();
  if (configured) {
    safeLoadConfig(configManager);
  }

  const toolkit = createDefaultToolkit(process.cwd());
  const pluginRegistry = new PluginRegistry();

  const mcpBridge = new MCPBridge();

  const pgPlugin = pluginRegistry.getPlugin('postgresql');
  const pgConfig = pgPlugin?.config ?? {};
  let sessionManager: SessionManager;
  if (pgPlugin?.enabled && pgConfig['connectionString']) {
    try {
      const pgAdapter = new PostgresStorageAdapter({
        connectionString: pgConfig['connectionString'] as string,
        max: (pgConfig['poolSize'] as number) ?? 5,
      } as any);
      sessionManager = new SessionManager({ storageAdapter: pgAdapter });
    } catch (e) {
      console.error('Failed to initialize PostgreSQL adapter, falling back to SQLite', e);
      sessionManager = new SessionManager();
    }
  } else {
    sessionManager = new SessionManager();
  }

  // Set sessions directory for filesystem fallback, then recover orphaned sessions
  const sessionsDir = join(getDataDir(), 'sessions');
  try {
    const store = (sessionManager as any).store;
    if (store && typeof store.setSessionsDir === 'function') {
      store.setSessionsDir(sessionsDir);
    }
    if (store && typeof store.recoverOrphanedSessions === 'function') {
      const recovered = store.recoverOrphanedSessions(sessionsDir);
      if (recovered > 0) {
        console.log(`Startup: recovered ${recovered} orphaned session(s) from filesystem`);
      }
    }
  } catch { /* non-critical */ }

  const crewManager = new CrewManager();

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
      // RAG init is best-effort
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
    telegramBridge: null,
    discordBridge: null,
    slackBridge: null,
    emailBridge: null,
    redisRuntime: null,
    webhookRuntime: null,
    sqliteBrowser: null,
    mcpBridge,
    dek: null,
  };

  // Boot-time channel auto-start — bridge starts, agent attaches on first session
  const tgPlugin = state!.pluginRegistry.getPlugin('telegram');
  const tgConfig = tgPlugin?.config ?? {};
  if (tgPlugin?.enabled && tgConfig['botToken'] && !process.env['AGENTX_DAEMON_HANDLES_TG']) {
    try {
      const gw = new Gateway();
      state!.gateway = gw;
      gw.registerTelegram(tgConfig['botToken'] as string);
      gw.startChannel('telegram').then(() => {
        const bridge = gw.getTelegramBridge();
        if (bridge) state!.telegramBridge = bridge;
        try {
          const entry = (gw as any).registry.getChannel('telegram');
          if (entry?.plugin) entry.plugin.setAgent(ensureChannelAgent());
        } catch { /* agent can attach later */ }
      }).catch((e: unknown) => {
        console.error('Failed to start Telegram channel on boot:', (e as Error).message);
        state!.gateway = null;
        state!.telegramBridge = null;
      });
    } catch (e) {
      console.error('Failed to register Telegram on boot:', (e as Error).message);
      state!.gateway = null;
    }
  }

  return state!;
}

export function setEngineDEK(dek: Buffer | null): void {
  if (state) {
    state.dek = dek;
    state.configManager.setDEK(dek);
    state.sessionManager.setDEK(dek);
    state.crewManager.setDEK(dek);
  }
}

export function createAgent(config?: AgentXConfig, sessionId?: string): Agent {
  const eng = getEngine();
  let cfg: AgentXConfig;
  if (config) {
    cfg = config;
  } else {
    try {
      cfg = eng.configManager.load();
    } catch {
      cfg = getDefaultConfig();
    }
  }

  const activeProvider = cfg.provider.activeProvider as ProviderId;
  const providerCfg = cfg.provider.providers[activeProvider];
  const apiKey = providerCfg?.apiKey;

  if (providerCfg?.configured) {
    try {
      const prov = ProviderFactory.create(activeProvider, apiKey, providerCfg?.baseUrl);
      prov.validate().catch(() => {});
    } catch {
      // provider not available yet
    }
  }

  

  let session;
  if (sessionId) {
    session = eng.sessionManager.restoreSession(sessionId);
    if (!session) {
      session = eng.sessionManager.createSession(
        activeProvider,
        cfg.provider.activeModel,
        undefined,
        pendingCwd || (cfg as any).scopePath || '',
      );
    }
  } else {
    session = eng.sessionManager.createSession(
      activeProvider,
      cfg.provider.activeModel,
      undefined,
        pendingCwd!,
    );
  }
  if (session?.scopePath) {
    eng.toolkit.executor.setScopePath(session.scopePath);
  }
  pendingCwd = null;

  const agent = new Agent({
    config: cfg,
    sessionId: session.id,
    systemPrompt: '',
    scopePath: session.scopePath,
    toolExecutor: eng.toolkit.executor,
    toolRegistry: eng.toolkit.registry,
  });

  // Replace the Agent's internal CrewManager with the shared instance
  // so crew changes via the API are immediately visible to the orchestrator
  (agent.sauce as { crew: CrewManager }).crew = eng.crewManager;
  agent.sauce.crew.refresh();

  // Sync enabled crew members into the Agent's CrewOrchestrator
  const enabledCrews = eng.crewManager.listEnabled();
  for (const crew of enabledCrews) {
    agent.addCrewMember(crew);
    agent.setCrewEnabled(crew.id, true);
  }

  // Wire session manager into CrewOrchestrator for crew session isolation (Phase 6)
  const crewOrch = (agent as any).crewOrchestrator;
  if (crewOrch && typeof crewOrch.setSessionManager === 'function') {
    crewOrch.setSessionManager(eng.sessionManager);
  }

  eng.agent = agent;

  // Create session logger for this agent
  const sessionLogger = new SessionLogger(session.id);
  sessionLogger.init();
  agent.sessionLogger = sessionLogger;

  // Set context persistence directory for session restore
  const dataDir = getDataDir();
  const sessDir = join(dataDir, 'sessions', session.id);
  agent.setContextPersistDir(sessDir);

  // Wire token logging to persistent DB
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

  // Bridge agent events to telemetry bus + persist token logs
  agent.events.on((event) => {
    eng.telemetry.emit(event as any);
    // Persist token usage to DB for every token_usage event (catches all paths)
    const ev = event as Record<string, unknown>;
    if (ev['type'] === 'token_usage') {
      const totalTokens = (ev['totalTokens'] as number) ?? 0;
      const inputTokens = (ev['inputTokens'] as number) ?? 0;
      const outputTokens = (ev['outputTokens'] as number) ?? 0;
      const costUsd = (ev['costUsd'] as number) ?? 0;
      // Sync to session table and SessionManager's tracker (prevents auto-save overwrite)
      (eng.sessionManager as any).store.updateSession(session.id, { tokensUsed: totalTokens });
      const smTracker = (eng.sessionManager as any).tokenTracker;
      if (smTracker?.setUsed) smTracker.setUsed(totalTokens);
      if (inputTokens > 0 || outputTokens > 0) {
        try {
          eng.sessionManager.addTokenLog({
            sessionId: session.id,
            inputTokens,
            outputTokens,
            model: cfg.provider.activeModel,
            costUsd,
            providerId: cfg.provider.activeProvider,
            crewId: (ev['crewId'] as string) || undefined,
          });
        } catch { /* best effort */ }
      }
    }
  });

  // ─── Create Gateway for channel management ───
  if (!eng.gateway) {
    const gateway = new Gateway();
    eng.gateway = gateway;
  }
  eng.gateway!.attachAgent(agent);

  // Start Telegram bridge via Gateway (skip if daemon handles it)
  const tgPlugin = eng.pluginRegistry.getPlugin('telegram');
  const tgConfig = tgPlugin?.config ?? {};
  if (tgPlugin?.enabled && tgConfig['botToken'] && !eng.telegramBridge && !process.env['AGENTX_DAEMON_HANDLES_TG']) {
    try {
      // Create a dedicated agent for Telegram so it doesn't conflict with web UI
      const channelAgent = ensureChannelAgent();
      const tgChannelPlugin = eng.gateway!.registerTelegram(tgConfig['botToken'] as string);
      tgChannelPlugin.setAgent(channelAgent);
      eng.gateway!.startChannel('telegram').catch((e: unknown) => {
        console.error('Failed to start Telegram channel', e);
      }).then(() => {
        if (eng.gateway) {
          const bridge = eng.gateway.getTelegramBridge();
          if (bridge) {
            eng.telegramBridge = bridge;
          }
        }
      });
    } catch (e) {
      console.error('Failed to start Telegram bridge', e);
    }
  } else if (eng.gateway && tgPlugin?.enabled && tgConfig['botToken']) {
    // Bridge already running — ensure Telegram has its dedicated agent
    try {
      const channelAgent = ensureChannelAgent();
      const entry = (eng.gateway as any).registry.getChannel('telegram');
      if (entry?.plugin && 'setAgent' in entry.plugin) {
        entry.plugin.setAgent(channelAgent);
      }
    } catch { /* best-effort */ }
  }

  // Start Discord bridge if plugin is configured (direct bridge until Gateway migration)
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
          undefined,
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

  // Start Slack bridge if plugin is configured
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
          undefined,
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

  // Start Email bridge if plugin is configured
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

  // Start Redis cache runtime
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

  // Start Webhook notifier
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

  // Start SQLite browser
  if (!eng.sqliteBrowser) {
    const sqlPlugin = eng.pluginRegistry.getPlugin('sqlite-web');
    if (sqlPlugin?.enabled) {
      eng.sqliteBrowser = new SQLiteBrowserRuntime(
        { readOnly: (sqlPlugin.config['readOnly'] as boolean) ?? true },
      );
    }
  }

  eng.mcpBridge.discover().then((manifests) => {
    for (const manifest of manifests) {
      eng.mcpBridge.load(manifest).catch((e) => {
        console.error(`Failed to start MCP server "${manifest.id}"`, e);
      });
    }
  }).catch(() => {});

  return agent;
}

function getDefaultConfig(): AgentXConfig {
  return {
    provider: {
      activeProvider: 'opencode-zen',
      activeModel: 'deepseek-v4-flash-free',
      providers: {
        'opencode-zen': { configured: true },
      },
    },
    ui: {
      theme: 'dark',
      showTokenBar: true,
      showTimers: true,
      animationSpeed: 'normal',
    },
    organization: null,
    telemetry: false,
  };
}

export function getOrCreateAgent(config?: AgentXConfig): Agent {
  const eng = getEngine();
  if (eng.agent && !config) return eng.agent;
  return createAgent(config);
}

/** Create or return a dedicated agent for messaging channels — independent of web UI agent */
export function ensureChannelAgent(): Agent {
  const eng = getEngine();
  if (eng.channelAgent) return eng.channelAgent;

  let cfg: AgentXConfig;
  try {
    cfg = eng.configManager.load();
  } catch {
    cfg = getDefaultConfig();
  }

  const activeProvider = cfg.provider.activeProvider as ProviderId;
  const CHANNEL_SESSION_ID = '__channel__';

  // Restore persistent channel session, or create it once
  let session = eng.sessionManager.restoreSession(CHANNEL_SESSION_ID);
  if (!session) {
    session = eng.sessionManager.createSession(
      activeProvider,
      cfg.provider.activeModel,
      undefined,
      process.cwd(),
      CHANNEL_SESSION_ID,
    );
  }

  const agent = new Agent({
    config: cfg,
    sessionId: session.id,
    systemPrompt: '',
    scopePath: session.scopePath,
    toolExecutor: eng.toolkit.executor,
    toolRegistry: eng.toolkit.registry,
  });
  (agent.sauce as { crew: CrewManager }).crew = eng.crewManager;
  agent.sauce.crew.refresh();

  const crewOrch = (agent as any).crewOrchestrator;
  if (crewOrch && typeof crewOrch.setSessionManager === 'function') {
    crewOrch.setSessionManager(eng.sessionManager);
  }

  const dataDir = getDataDir();
  const sessDir = join(dataDir, 'sessions', session.id);
  agent.setContextPersistDir(sessDir);

  const channelLogger = new SessionLogger(session.id);
  channelLogger.init();
  agent.sessionLogger = channelLogger;

  eng.channelAgent = agent;
  return agent;
}

export function destroyAgent(): void {
  const eng = getEngine();
  // Unsubscribe WebSocket event listener before destroying agent
  unsubscribeAgent();
  if (eng.agent) {
    (eng.agent as any).sessionLogger?.close();
    eng.agent.endSession();
    eng.agent = null;
  }
  // Keep gateway and telegram bridge alive — they serve Telegram independently
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
}
