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
  initLogCollector,
  getLogCollector,
  GrowthEngine,
  EmotionEngine,
  ExperienceEngine,
} from '@agentx/engine';
import type { AgentXConfig, ProviderId, TelemetryBus, Session } from '@agentx/shared';
import type { PartPersistFn } from '@agentx/engine';
import { unsubscribeAgent } from './ws.js';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { getDataDir, getLogger } from '@agentx/shared';

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

function safeLoadConfig(configManager: ConfigManager): void {
  try {
    configManager.load();
  } catch {
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

  // Initialize log collector — hooks into the shared logger to capture all logs
  initLogCollector();

  const pgPlugin = pluginRegistry.getPlugin('postgresql');
  const pgConfig = pgPlugin?.config ?? {};
  let sessionManager: SessionManager;
  if (pgPlugin?.enabled && pgConfig['connectionString']) {
    try {
      const pgAdapter = new PostgresStorageAdapter({
        connectionString: pgConfig['connectionString'] as string,
        max: (pgConfig['poolSize'] as number) ?? 5,
      } as any);
      pgAdapter.connect().catch(e => {
        console.error('PostgreSQL connect/migrate failed, consider checking connection string or PG availability', e);
      });
      sessionManager = new SessionManager({ storageAdapter: pgAdapter });
    } catch (e) {
      console.error('Failed to initialize PostgreSQL adapter, falling back to SQLite', e);
      sessionManager = new SessionManager();
    }
  } else {
    sessionManager = new SessionManager();
  }

  const sessionsDir = join(getDataDir(), 'sessions');
  let store: any = undefined;
  try {
    store = (sessionManager as any).store;
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
  }
}

export function createAgent(config: AgentXConfig | undefined, session: Session): Agent {
  const eng = getEngine();
  let cfg: AgentXConfig;
  if (config) {
    cfg = config;
  } else {
    cfg = eng.configManager.load();
  }

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

  const agent = new Agent({
    config: cfg,
    sessionId: session.id,
    systemPrompt: '',
    scopePath: effectiveScopePath,
    toolExecutor: eng.toolkit.executor,
    toolRegistry: eng.toolkit.registry,
    onPart,
  });

  // Apply session mode immediately so the agent starts in the correct mode
  if (session.mode === 'plan') {
    agent.setPlanMode(true);
  } else {
    agent.setPlanMode(false);
  }

  agent.setSessionManager(eng.sessionManager);

  (agent.sauce as { crew: CrewManager }).crew = eng.crewManager;
  agent.sauce.crew.refresh();

  const enabledCrews = eng.crewManager.listEnabled();
  for (const crew of enabledCrews) {
    agent.addCrewMember(crew);
    agent.setCrewEnabled(crew.id, true);
  }

  const crewOrch = (agent as any).crewOrchestrator;
  if (crewOrch && typeof crewOrch.setSessionManager === 'function') {
    crewOrch.setSessionManager(eng.sessionManager);
  }

  eng.agent = agent;

  const sessionLogger = new SessionLogger(session.id);
  sessionLogger.init();
  agent.sessionLogger = sessionLogger;

  // Hook session-level logs into the global log collector
  getLogCollector().hookSessionLogger(sessionLogger);

  const dataDir = getDataDir();
  const sessDir = join(dataDir, 'sessions', session.id);
  agent.setContextPersistDir(sessDir, effectiveScopePath);

  // Wire session events to SessionStore (DB persistence)
  agent.onSessionEvent = (event) => {
    try {
      const store = (eng.sessionManager as any).store;
      if (store?.insertSessionEvent) {
        store.insertSessionEvent(event);
      }
    } catch { /* best-effort */ }
  };

  // Wire tool executions to SessionStore (DB persistence)
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
      const msgs = store.getMessages(session.id) as Array<{ role: string; content: string }>;
      const userAssistant = msgs.filter((m) => m.role === 'user' || m.role === 'assistant');
      const recent = userAssistant.slice(-20);
      for (const msg of recent) {
        if (msg.content) {
          agent.addToHistory({ role: msg.role as 'user' | 'assistant', content: msg.content });
        }
      }
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
    eng.telemetry.emit(event as any);
    const ev = event as Record<string, unknown>;
    if (ev['type'] === 'token_usage') {
      const totalTokens = (ev['totalTokens'] as number) ?? 0;
      const inputTokens = (ev['inputTokens'] as number) ?? 0;
      const outputTokens = (ev['outputTokens'] as number) ?? 0;
      const costUsd = (ev['costUsd'] as number) ?? 0;
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

  if (!eng.gateway) {
    const gateway = new Gateway();
    eng.gateway = gateway;
  }
  eng.gateway!.attachAgent(agent);

  const tgPlugin = eng.pluginRegistry.getPlugin('telegram');
  const tgConfig = tgPlugin?.config ?? {};
  if (tgPlugin?.enabled && tgConfig['botToken'] && !eng.telegramBridge && !process.env['AGENTX_DAEMON_HANDLES_TG']) {
    try {
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
    try {
      const channelAgent = ensureChannelAgent();
      const entry = (eng.gateway as any).registry.getChannel('telegram');
      if (entry?.plugin && 'setAgent' in entry.plugin) {
        entry.plugin.setAgent(channelAgent);
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
      undefined,
      process.cwd(),
      CHANNEL_SESSION_ID,
    );
  }

  return createAgent(cfg, session);
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
}

export function getVitals(): Record<string, unknown> {
  try {
    const eng = getEngine();
    const db = eng.sessionManager.getDb();
    if (!db) {
      return { status: 'uninitialized', ageDays: 0, level: 'Fresh', wisdomScore: 0, totalExperiences: 0, totalInteractions: 0, totalCorrections: 0, avgConfidence: 0, currentMood: 'neutral', moodIntensity: 0.3, memories: { total: 0, categories: {} }, diaryEntries: 0, brainSizeFormatted: '0 B', nextMilestoneAt: null, capabilities: [], birthDate: null };
    }

    const growth = new GrowthEngine(db);
    const emotion = new EmotionEngine(db);
    const experience = new ExperienceEngine(db);

    const growthState = growth.getCurrentState();
    const emotionState = emotion.getCurrentState();
    const ageDays = growth.getAgeDays();

    let memoriesTotal = 0;
    let memoryCategories: Record<string, number> = {};
    try {
      const memRows = db.prepare('SELECT type, COUNT(*) as c FROM agent_memories GROUP BY type').all() as Array<{ type: string; c: number }>;
      memoriesTotal = memRows.reduce((s, r) => s + r.c, 0);
      memRows.forEach(r => { memoryCategories[r.type] = r.c; });
    } catch { /* table may not exist */ }

    let diaryEntries = 0;
    try { const r = db.prepare('SELECT COUNT(*) as c FROM agent_diary').get() as { c: number }; diaryEntries = r?.c ?? 0; } catch { /* */ }

    let brainSizeFormatted = '0 B';
    try {
      const pageCount = db.prepare('PRAGMA page_count').get() as { page_count: number } | undefined;
      const pageSize = db.prepare('PRAGMA page_size').get() as { page_size: number } | undefined;
      if (pageCount && pageSize) {
        const bytes = pageCount.page_count * pageSize.page_size;
        brainSizeFormatted = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
      }
    } catch { /* */ }

    let birthDate: string | null = null;
    try {
      const sources = [
        db.prepare('SELECT MIN(created_at) as d FROM agent_experiences').get() as { d: string | null } | undefined,
        db.prepare('SELECT MIN(created_at) as d FROM agent_memories').get() as { d: string | null } | undefined,
        db.prepare('SELECT MIN(created_at) as d FROM agent_diary').get() as { d: string | null } | undefined,
      ];
      const dates = sources.map(s => s?.d).filter(Boolean) as string[];
      if (dates.length > 0) birthDate = dates.sort()[0];
    } catch { /* */ }

    let capabilities: string[] = [];
    if (growthState?.capabilities) {
      try { capabilities = JSON.parse(growthState.capabilities); } catch { capabilities = []; }
    }

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
