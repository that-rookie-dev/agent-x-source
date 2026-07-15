import {
  Agent,
  applyWebSearchConfigFromAgentConfig,
  buildCrewPrivateIdentityPrompt,
  SessionLogger,
  getLogCollector,
  Gateway,
  RedisCacheRuntime,
  WebhookNotifierRuntime,
  type PartPersistFn,
  type CrewManager,
  type TelegramChannelPlugin,
} from '@agentx/engine';
import type { AgentXConfig, Session, TelemetryEvent } from '@agentx/shared';
import { getDataDir, getLogger, hydrateMessageHistoryEntries, isChannelSessionId, parseChannelBindingFromSessionId } from '@agentx/shared';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { getEngine } from './state.js';
import { ensureChannelAgent, rewireTelegramChannelPermissions } from './channels.js';
import { resolveCrewPrivateHostForAgent } from '../host-crew-session.js';
import { persistClarificationResumeFromAgent } from '../clarification-resume.js';
import { sessionSettings } from '../chat-helpers.js';
import { unsubscribeAgent } from '../ws.js';

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
      const store = eng.sessionManager.getStorageAdapter();
      if (store && typeof store.insertPart === 'function') {
        store.insertPart(sessionId, part);
      }
    } catch { /* best effort */ }
  };

  // Load persona config from DB (brain/secret-sauce storage)
  let persona: any = null;
  try {
    const store = eng.sessionManager.getStorageAdapter();
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
  const store = eng.sessionManager.getStorageAdapter();
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
    pgPool: eng.pgPool ?? null,
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
        eng.sessionManager.updateSession({ mode: 'agent', hyperdrive: false });
      } catch { /* best-effort */ }
    }
  } else if (isAgentXCore || session.mode === 'plan') {
    agent.setPlanMode(true);
    if (isAgentXCore && session.mode !== 'plan') {
      try {
        eng.sessionManager.updateSession({ mode: 'plan', hyperdrive: false });
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

  // Global config is the runtime source of truth — keep the session row in sync.
  try {
    eng.sessionManager.syncActiveSessionRuntime({
      providerId: cfg.provider.activeProvider,
      modelId: cfg.provider.activeModel,
    });
  } catch { /* best-effort */ }

  // Keep in-memory sessionSettings aligned when Telegram or UI toggles mode.
  agent.events.on((event) => {
    if (event.type === 'plan_mode_exited') sessionSettings.mode = 'agent';
    if (event.type === 'plan_mode_entered') sessionSettings.mode = 'plan';
  });

  // Watchdog: auto-resume interrupted task on startup (Agent-X sessions only).
  // Skip channel super-session — it must stay idle for inbound Telegram/Slack messages.
  if (!isCrewPrivate && !isAutomationRun && !isChannelSessionId(session.id)) {
  try {
    const store = eng.sessionManager.getStorageAdapter();
    if (store && typeof store.getTaskSnapshot === 'function') {
      const snapshot = store.getTaskSnapshot(session.id);
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
          store.deleteTaskSnapshot?.(session.id);
        }
      }
    }
  } catch { /* best-effort */ }
  }

  // Restore accumulated token count from session
  const smTracker = eng.sessionManager.getTokenTracker();
  if (smTracker) {
    agent.tokens.setUsed(smTracker.tokensUsed);
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

  const crewOrch = agent.getCrewOrchestrator();
  if (typeof crewOrch.setSessionManager === 'function') {
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
      const store = eng.sessionManager.getStorageAdapter();
      if (store?.insertSessionEvent) {
        store.insertSessionEvent(event);
      }
    } catch { /* best-effort */ }
  };

  // Wire tool executions to StorageAdapter (DB persistence)
  try {
    const executor = agent.getToolExecutor();
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
    const store = eng.sessionManager.getStorageAdapter();
    if (store?.getMessages) {
      const msgs = store.getMessages(session.id);
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
    } as unknown as TelemetryEvent);
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
      const smTracker = eng.sessionManager.getTokenTracker();
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
        const channelAgent = ensureChannelAgent('telegram');
        const plugin = eng.gateway.registry.getPlugin<TelegramChannelPlugin>('telegram');
        if (plugin) {
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
        const e = event as Record<string, unknown>;
        if (typeof e.type === 'string' && eng.webhookRuntime) {
          void eng.webhookRuntime.notify(e.type, e);
        }
      });
    }
  }

  rewireTelegramChannelPermissions(eng);

  return agent;
}

export function getOrCreateAgent(config?: AgentXConfig, session?: Session): Agent {
  const eng = getEngine();
  if (session) {
    return getOrCreateBoundSessionAgent(session, config);
  }
  if (eng.agent && !config) return eng.agent;
  const sess = eng.sessionManager.getActiveSession();
  if (!sess) throw new Error('No active session. Create a session first.');
  return createAgent(config, sess);
}

/** Resolve or create an agent for a specific session without hijacking the UI agent. */
export function getOrCreateBoundSessionAgent(session: Session, config?: AgentXConfig): Agent {
  const eng = getEngine();
  if (eng.agent?.currentSessionId === session.id && !config) {
    return eng.agent;
  }

  const map = eng.boundSessionAgents ?? (eng.boundSessionAgents = new Map());
  const cached = map.get(session.id);
  if (cached && !config) {
    try {
      eng.sessionManager.syncActiveSessionRuntime({
        providerId: eng.configManager.load().provider.activeProvider,
        modelId: eng.configManager.load().provider.activeModel,
      });
    } catch { /* best-effort */ }
    return cached;
  }

  eng.sessionManager.restoreSession(session.id);
  const agent = createAgent(config, session, { attachToEngine: false });
  map.set(session.id, agent);
  return agent;
}

export function destroyAgent(): void {
  const eng = getEngine();
  unsubscribeAgent();
  if (eng.agent) {
    eng.agent?.sessionLogger?.close();
    eng.agent.endSession();
    eng.agent = null;
  }
}
