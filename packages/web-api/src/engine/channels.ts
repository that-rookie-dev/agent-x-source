import type { Agent } from '@agentx/engine';
import type { ChannelBindingId, ProviderId } from '@agentx/shared';
import { isChannelSessionId, channelSessionIdForBinding, CHANNEL_SESSION_ID } from '@agentx/shared';
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
  let session = eng.sessionManager.restoreSession(sessionId);
  // Legacy single-bucket telegram transcript
  if (!session && channel === 'telegram') {
    session = eng.sessionManager.restoreSession(CHANNEL_SESSION_ID);
  }
  if (!session) {
    session = eng.sessionManager.createSession(
      cfg.provider.activeProvider as ProviderId,
      cfg.provider.activeModel,
      process.cwd(),
      sessionId,
    );
  } else {
    eng.sessionManager.restoreSession(session.id);
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
  return agent;
}
