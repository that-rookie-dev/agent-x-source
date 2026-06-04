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
} from '@agentx/engine';
import type { AgentXConfig, ProviderId, TelemetryBus } from '@agentx/shared';
import { unsubscribeAgent } from './ws.js';

export interface EngineState {
  configManager: ConfigManager;
  sessionManager: SessionManager;
  agent: Agent | null;
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

  const crewManager = new CrewManager();

  const telemetry = new DefaultTelemetryBus({ enabled: configured });
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

  const activeCrew = eng.crewManager.getActive()!;

  let session;
  if (sessionId) {
    session = eng.sessionManager.restoreSession(sessionId);
    if (!session) {
      session = eng.sessionManager.createSession(
        activeProvider,
        cfg.provider.activeModel,
        activeCrew.id,
        process.cwd(),
      );
    }
  } else {
    session = eng.sessionManager.createSession(
      activeProvider,
      cfg.provider.activeModel,
      activeCrew.id,
      process.cwd(),
    );
  }

  const agent = new Agent({
    config: cfg,
    sessionId: session.id,
    systemPrompt: activeCrew.systemPrompt,
    toolExecutor: eng.toolkit.executor,
    toolRegistry: eng.toolkit.registry,
  });

  eng.agent = agent;

  // Bridge agent events to telemetry bus
  agent.events.on((event) => {
    eng.telemetry.emit(event as any);
  });

  // ─── Create Gateway for channel management ───
  if (!eng.gateway) {
    const gateway = new Gateway();
    gateway.attachAgent(agent);
    eng.gateway = gateway;
  }

  // Start Telegram bridge via Gateway (skip if daemon handles it)
  const tgPlugin = eng.pluginRegistry.getPlugin('telegram');
  const tgConfig = tgPlugin?.config ?? {};
  if (tgPlugin?.enabled && tgConfig['botToken'] && !eng.telegramBridge && !process.env['AGENTX_DAEMON_HANDLES_TG']) {
    try {
      const tgChannelPlugin = eng.gateway!.registerTelegram(tgConfig['botToken'] as string);
      tgChannelPlugin.setAgent(agent);
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
        const userCrew = eng.crewManager.getActive()!;
        const userSession = eng.sessionManager.createSession(
          userProvider,
          userCfg.provider.activeModel,
          userCrew.id,
          process.cwd(),
        );
        return new Agent({
          config: userCfg,
          sessionId: userSession.id,
          systemPrompt: userCrew.systemPrompt,
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
        const userCrew = eng.crewManager.getActive()!;
        const userSession = eng.sessionManager.createSession(
          userCfg.provider.activeProvider,
          userCfg.provider.activeModel,
          userCrew.id,
          process.cwd(),
        );
        return new Agent({
          config: userCfg,
          sessionId: userSession.id,
          systemPrompt: userCrew.systemPrompt,
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
        systemPrompt: activeCrew.systemPrompt,
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
      activeProvider: 'openai',
      activeModel: 'gpt-4o-mini',
      providers: {},
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

export function destroyAgent(): void {
  const eng = getEngine();
  // Unsubscribe WebSocket event listener before destroying agent
  unsubscribeAgent();
  if (eng.agent) {
    eng.agent.endSession();
    eng.agent = null;
  }
  if (eng.gateway) {
    void eng.gateway.stopAll();
    eng.gateway = null;
  }
  if (eng.telegramBridge) {
    eng.telegramBridge.stop();
    eng.telegramBridge = null;
  }
  if (eng.discordBridge) {
    eng.discordBridge.stop();
    eng.discordBridge = null;
  }
  if (eng.slackBridge) {
    eng.slackBridge.stop();
    eng.slackBridge = null;
  }
  if (eng.emailBridge) {
    eng.emailBridge.stop();
    eng.emailBridge = null;
  }
  if (eng.redisRuntime) {
    void eng.redisRuntime.disconnect();
    eng.redisRuntime = null;
  }
  if (eng.webhookRuntime) {
    eng.webhookRuntime.setEnabled(false);
    eng.webhookRuntime = null;
  }
  if (eng.sqliteBrowser) {
    eng.sqliteBrowser = null;
  }
}

export function clearEngine(): void {
  if (state?.agent) {
    state.agent.endSession();
  }
  state = null;
}
