import type { Agent } from '@agentx/engine';
import type { ChannelBindingId, ProviderId } from '@agentx/shared';
import { isChannelSessionId, channelSessionIdForBinding, CHANNEL_SESSION_ID, hydrateMessageHistoryEntries, getAgentFilesDir } from '@agentx/shared';
import { getEngine } from './state.js';
import { createAgent } from './agent-lifecycle.js';

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

/** Align a channel super-session agent with its linked desktop workspace and crew roster. */
export function syncChannelSuperSessionContext(
  eng?: ReturnType<typeof getEngine>,
  channel: ChannelBindingId = 'telegram',
): void {
  const e = eng ?? getEngine();
  let channelAgent: Agent | null = e.channelAgents?.get(channel) ?? null;
  if (!channelAgent) {
    try {
      channelAgent = ensureChannelAgent(channel);
    } catch {
      return;
    }
  }

  const binding = e.channelSessionBindings?.[channel];
  const bound = binding?.sessionId ? e.sessionManager.getSessionById(binding.sessionId) : null;
  const active = bound
    ?? e.sessionManager.getActiveSession()
    ?? (e.agent?.currentSessionId && !isChannelSessionId(e.agent.currentSessionId)
      ? e.sessionManager.getSessionById(e.agent.currentSessionId)
      : null);

  if (active?.scopePath) {
    channelAgent.setScopePath(active.scopePath);
    // Persist the scope path to the channel session so it survives server restarts.
    // Without this, the channel session keeps its original scope_path (e.g. "/" from
    // process.cwd()) and the next ensureChannelAgent() restores a broken scope.
    try {
      const sessionId = channelSessionIdForBinding(channel);
      const channelSession = e.sessionManager.getSessionById(sessionId);
      if (channelSession && channelSession.scopePath !== active.scopePath) {
        e.sessionManager.getStorageAdapter().updateSession(sessionId, { scopePath: active.scopePath });
      }
    } catch { /* best-effort */ }
  }

  channelAgent.setLinkedContextSessionId(active?.id ?? null);

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

export function ensureChannelAgent(channel: ChannelBindingId = 'telegram'): Agent {
  const eng = getEngine();
  const map = eng.channelAgents ?? (eng.channelAgents = new Map());
  const cached = map.get(channel);
  if (cached) {
    if (channel === 'telegram') eng.channelAgent = cached;
    return cached;
  }

  const cfg = eng.configManager.load();
  const sessionId = channelSessionIdForBinding(channel);

  // Channel agents operate in the Agent-X app files directory by default.
  // This keeps generated attachments, PDFs, temp scratch files, and channel deliverables
  // sandboxed inside the app's own data dir instead of the user's workspace, so file
  // read/write/delete operations for internal processing never require permission.
  const preferredScope = getAgentFilesDir();

  let session = eng.sessionManager.restoreSession(sessionId);
  // Legacy single-bucket telegram transcript
  if (!session && channel === 'telegram') {
    session = eng.sessionManager.restoreSession(CHANNEL_SESSION_ID);
  }
  if (!session) {
    session = eng.sessionManager.createSession(
      cfg.provider.activeProvider as ProviderId,
      cfg.provider.activeModel,
      preferredScope,
      sessionId,
    );
  } else {
    eng.sessionManager.restoreSession(session.id);
    // Fix a broken scope path (e.g. "/" from a prior process.cwd() creation).
    // The channel agent must never be scoped to the filesystem root.
    if (!session.scopePath || session.scopePath === '/') {
      try {
        eng.sessionManager.updateSession({ scopePath: preferredScope });
        session.scopePath = preferredScope;
      } catch { /* best-effort */ }
    }
    if (session.mode !== 'agent' || session.hyperdrive) {
      try {
        eng.sessionManager.updateSession({ mode: 'agent', hyperdrive: false });
      } catch { /* best-effort */ }
      session.mode = 'agent';
      session.hyperdrive = false;
    }
  }

  const agent = createAgent(cfg, session, { attachToEngine: false });
  map.set(channel, agent);
  if (channel === 'telegram') eng.channelAgent = agent;

  // Inherit the app's current location/timezone so channel replies (Telegram, Slack, etc.)
  // use the same context as the desktop/web UI instead of stale or missing location.
  agent.setClientSituation(eng.clientSituation);

  // Restore recent conversation history from DB into the channel agent's memory.
  // Without this, a reconnect creates a fresh agent with empty messages and the
  // agent forgets everything discussed in prior sessions on this channel.
  try {
    const store = eng.sessionManager.getStorageAdapter();
    if (store?.getMessages) {
      const msgs = store.getMessages(session.id);
      const restorable = msgs.filter((m) => m.role === 'user' || m.role === 'assistant');
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

  return agent;
}
