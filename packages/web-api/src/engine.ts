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
  TelegramBridge,
  MCPBridge,
} from '@agentx/engine';
import type { AgentXConfig, ProviderId, TelemetryBus } from '@agentx/shared';

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
  telegramBridge: TelegramBridge | null;
  mcpBridge: MCPBridge;
  dek: Buffer | null;
}

let state: EngineState | null = null;

function safeLoadConfig(configManager: ConfigManager): void {
  try {
    configManager.load();
  } catch {
    // not configured yet — that's fine
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

  // Check if PostgreSQL plugin is configured and should replace default SQLite storage
  const pgPlugin = pluginRegistry.getPlugin('postgresql');
  const pgConfig = pgPlugin?.config ?? {};
  let sessionManager: SessionManager;
  if (pgPlugin?.enabled && pgConfig['connectionString']) {
    try {
      // Cast to any to avoid excess property checks against the upstream PostgresConfig
      // type which may not include ``connectionString`` in some type definitions.
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
    telegramBridge: null,
    mcpBridge,
    dek: null,
  };

  return state;
}

/**
 * Set the Data Encryption Key on the engine.
 * This enables encrypted config read/write.
 */
export function setEngineDEK(dek: Buffer | null): void {
  if (state) {
    state.dek = dek;
    state.configManager.setDEK(dek);
  }
}

export function createAgent(config?: AgentXConfig): Agent {
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

  const activeCrew = eng.crewManager.getActive();

  const session = eng.sessionManager.createSession(
    activeProvider,
    cfg.provider.activeModel,
    activeCrew.id,
    process.cwd(),
  );

  const agent = new Agent({
    config: cfg,
    sessionId: session.id,
    systemPrompt: activeCrew.systemPrompt,
    toolExecutor: eng.toolkit.executor,
    toolRegistry: eng.toolkit.registry,
  });

  eng.agent = agent;

  // Start Telegram bridge if plugin is configured
  const tgPlugin = eng.pluginRegistry.getPlugin('telegram');
  const tgConfig = tgPlugin?.config ?? {};
  if (tgPlugin?.enabled && tgConfig['botToken'] && !eng.telegramBridge) {
    try {
      const bridge = new TelegramBridge({
        botToken: tgConfig['botToken'] as string,
      });
      bridge.setMessageHandler((text: string, chatId: number) => {
        agent.sendMessage(text).then((reply) => {
          // agent.sendMessage returns a Message object; bridge.sendMessage expects a string
          const out = (reply as any)?.content ?? String(reply);
          bridge.sendMessage(chatId, out);
        }).catch(() => {});
      });
      bridge.setCommandHandler(async (cmd: string, _args: string[], _chatId: number) => {
        if (cmd === 'start' || cmd === 'help') {
          return 'Agent-X Telegram bot connected. Send me a message and I\'ll forward it to your agent.';
        }
        return null; // pass to message handler
      });
      bridge.start().then(() => {
        eng.telegramBridge = bridge;
      }).catch((e: unknown) => {
        console.error('Failed to start Telegram bridge', e);
      });
    } catch (e) {
      console.error('Failed to start Telegram bridge', e);
    }
  }

  // Auto-start MCP servers (fire-and-forget)
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
  if (eng.agent) {
    eng.agent.endSession();
    eng.agent = null;
  }
  if (eng.telegramBridge) {
    eng.telegramBridge.stop();
    eng.telegramBridge = null;
  }
}

export function clearEngine(): void {
  if (state?.agent) {
    state.agent.endSession();
  }
  state = null;
}
