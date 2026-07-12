import {
  formatChannelBindingLabel,
  detectChannelHandoffIntent,
  isContinuationTrigger,
  resolveContinuationInstruction,
  isChannelCoveredMcpIntegration,
  isUserFacingSession,
  isChannelSessionId,
  type ChannelBindingId,
  type ChannelSessionBinding,
  type Session,
  type SessionResumeState,
} from '@agentx/shared';
import { setChannelInboundAgentResolver } from '@agentx/engine';
import { getTelegramInboundStatus, getTelegramRuntimeHints } from './channels-sync.js';
import { ensureChannelAgent, getEngine, syncChannelSuperSessionContext } from './engine.js';

export interface EngineWithChannelBindings {
  channelSessionBindings?: Partial<Record<ChannelBindingId, ChannelSessionBinding>>;
}

export function resolveUiSessionForChannel(eng: ReturnType<typeof getEngine>): Session | null {
  const active = eng.sessionManager.getActiveSession();
  if (active && isUserFacingSession({
    id: active.id,
    parentId: active.parentId ?? null,
    contextKind: active.contextKind ?? 'agent_x',
  })) {
    return active;
  }
  const main = eng.agent;
  if (main?.currentSessionId && !isChannelSessionId(main.currentSessionId)) {
    const session = eng.sessionManager.getSessionById(main.currentSessionId);
    if (session && isUserFacingSession({
      id: session.id,
      parentId: session.parentId ?? null,
      contextKind: session.contextKind ?? 'agent_x',
    })) {
      return session;
    }
  }
  return null;
}

export function getChannelSessionBinding(
  eng: EngineWithChannelBindings,
  channel: ChannelBindingId,
): ChannelSessionBinding | null {
  return eng.channelSessionBindings?.[channel] ?? null;
}

export function bindChannelToSession(
  eng: EngineWithChannelBindings & ReturnType<typeof getEngine>,
  channel: ChannelBindingId,
  session: Session,
): ChannelSessionBinding {
  const binding: ChannelSessionBinding = {
    channel,
    sessionId: session.id,
    contextKind: session.contextKind ?? 'agent_x',
    sessionTitle: session.title ?? undefined,
    boundAt: new Date().toISOString(),
  };
  eng.channelSessionBindings = { ...(eng.channelSessionBindings ?? {}), [channel]: binding };
  try {
    (eng.sessionManager as { setActiveSession?: (id: string) => void }).setActiveSession?.(session.id);
  } catch { /* best-effort */ }
  syncChannelSuperSessionContext(eng, channel);
  propagateTelegramConnectedToAgents(eng);
  return binding;
}

export function autoBindChannelToUiSession(
  eng: EngineWithChannelBindings & ReturnType<typeof getEngine>,
  channel: ChannelBindingId,
): ChannelSessionBinding | null {
  const existing = getChannelSessionBinding(eng, channel);
  if (existing) {
    const session = eng.sessionManager.getSessionById(existing.sessionId);
    if (session) return existing;
  }
  const uiSession = resolveUiSessionForChannel(eng);
  if (!uiSession) return null;
  return bindChannelToSession(eng, channel, uiSession);
}

export function resolvePreferredChannelBoundSession(
  eng: EngineWithChannelBindings & ReturnType<typeof getEngine>,
): Session | null {
  const bindings = Object.values(eng.channelSessionBindings ?? {}) as ChannelSessionBinding[];
  const sorted = bindings.sort((a, b) => b.boundAt.localeCompare(a.boundAt));
  for (const binding of sorted) {
    const session = eng.sessionManager.getSessionById(binding.sessionId);
    if (session) return session;
  }
  return null;
}

export async function pruneChannelCoveredMcpConnections(
  eng: ReturnType<typeof getEngine>,
): Promise<number> {
  let removed = 0;
  for (const connection of eng.integrationHub.listConnections()) {
    if (!isChannelCoveredMcpIntegration(connection.providerId)) continue;
    try {
      await eng.integrationHub.disconnect(connection.id);
      removed += 1;
    } catch { /* best-effort */ }
  }
  if (removed > 0) {
    try {
      eng.integrationHub.syncToToolkit(eng.toolkit.registry, eng.toolkit.executor);
    } catch { /* best-effort */ }
  }
  return removed;
}

export function resolveBoundSessionForChannel(
  eng: EngineWithChannelBindings & ReturnType<typeof getEngine>,
  channelId: string,
): Session | null {
  const channel = channelId as ChannelBindingId;
  const binding = getChannelSessionBinding(eng, channel);
  if (binding) {
    const bound = eng.sessionManager.getSessionById(binding.sessionId);
    if (bound) return bound;
  }
  return resolveUiSessionForChannel(eng);
}

export function isTelegramChannelOperational(eng: ReturnType<typeof getEngine>): boolean {
  const status = getTelegramInboundStatus();
  return Boolean(status.inboundReady && status.bridgeRunning);
}

export function propagateTelegramConnectedToAgents(eng: ReturnType<typeof getEngine>): void {
  const operational = isTelegramChannelOperational(eng);
  const chatIdRaw = eng.configManager.load().channels?.telegram?.chatId;
  const chatId = chatIdRaw ? Number(chatIdRaw) : null;
  const agents: Agent[] = [];
  const seen = new Set<Agent>();
  for (const candidate of [eng.agent, eng.channelAgent, ...(eng.channelAgents ? [...eng.channelAgents.values()] : [])]) {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      agents.push(candidate);
    }
  }
  for (const agent of agents) {
    try {
      agent!.setTelegramConnected(operational, Number.isFinite(chatId) ? chatId : null);
    } catch { /* best-effort */ }
  }
}

export async function sendChannelHandoffPing(
  eng: ReturnType<typeof getEngine>,
  channel: ChannelBindingId,
  session: Session,
): Promise<{ ok: boolean; error?: string }> {
  if (channel !== 'telegram') {
    return { ok: false, error: `${formatChannelBindingLabel(channel)} handoff ping not implemented` };
  }
  const status = getTelegramInboundStatus();
  if (!status.inboundReady || !status.bridgeRunning) {
    return { ok: false, error: 'Telegram channel is not running. Open Settings → Channels and verify your bot.' };
  }
  const bridge = eng.telegramBridge;
  const chatId = eng.configManager.load().channels?.telegram?.chatId?.trim()
    ?? getTelegramRuntimeHints().telegramChatId
    ?? undefined;
  if (!bridge?.isRunning() || !chatId) {
    return { ok: false, error: 'Telegram chat is not linked yet. Message your bot once, then Verify in Channels.' };
  }
  const title = session.title?.trim() || 'your session';
  const text = [
    `Continuing *${title}* here on Telegram.`,
    '',
    'This thread is context-linked to your desktop session — Telegram chat stays separate, but goals, crew, and automations carry over.',
  ].join('\n');
  try {
    await bridge.sendToChat(Number(chatId), text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Telegram send failed' };
  }
}

export async function handleChannelHandoffRequest(input: {
  eng: EngineWithChannelBindings & ReturnType<typeof getEngine>;
  sessionId: string;
  text: string;
}): Promise<{ handled: boolean; reply?: string }> {
  const intent = detectChannelHandoffIntent(input.text);
  if (!intent) return { handled: false };

  const session = input.eng.sessionManager.getSessionById(input.sessionId);
  if (!session) return { handled: false };

  const binding = bindChannelToSession(input.eng, intent.channel, session);
  const label = formatChannelBindingLabel(intent.channel);

  if (intent.channel === 'telegram' && !isTelegramChannelOperational(input.eng)) {
    return {
      handled: true,
      reply: `${label} is configured under **Settings → Channels**, but the bot is not listening yet. Open Channels, verify your token, and message your bot once. Then ask again to continue here.`,
    };
  }

  const ping = await sendChannelHandoffPing(input.eng, intent.channel, session);
  if (!ping.ok) {
    return {
      handled: true,
      reply: `I linked this session to ${label}, but could not ping you there (${ping.error}). Open **Settings → Channels** to finish setup, then message the bot directly.`,
    };
  }

  return {
    handled: true,
    reply: `Done — I linked **${binding.sessionTitle ?? 'this session'}** to ${label} and sent you a ping there. Continue on ${label} for mobile; your desktop transcript stays separate, but I'll keep the same goals and context.`,
  };
}

export function buildContinueTurnInstruction(eng: ReturnType<typeof getEngine>, sessionId: string, userText = 'continue'): string | null {
  const store = (eng.sessionManager as unknown as {
    store?: {
      getMessages?: (id: string) => Array<{ role?: string; content?: string; parts?: unknown }>;
      getSessionResumeState?: (id: string) => Record<string, unknown> | null;
    };
  }).store;
  if (!store?.getMessages) return null;

  const messages = store.getMessages(sessionId);
  const resumeState = parseStoredResumeState(store.getSessionResumeState?.(sessionId));
  return resolveContinuationInstruction({ userText, messages, resumeState });
}

function parseStoredResumeState(row: Record<string, unknown> | null | undefined): SessionResumeState | null {
  if (!row) return null;
  let payload: Record<string, unknown> = {};
  const raw = row['payload'];
  if (typeof raw === 'string' && raw) {
    try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = {}; }
  } else if (raw && typeof raw === 'object') {
    payload = raw as Record<string, unknown>;
  }
  return {
    kind: (row['kind'] ?? 'questionnaire') as SessionResumeState['kind'],
    messageId: String(row['message_id'] ?? row['messageId'] ?? ''),
    questionnaireMessageId: payload.questionnaireMessageId as string | undefined,
    userText: payload.userText as string | undefined,
    lastFailure: payload.lastFailure as string | undefined,
    delegateCrewIds: payload.delegateCrewIds as string[] | undefined,
    primaryCrewId: payload.primaryCrewId as string | undefined,
    crewIntakeFromPicker: payload.crewIntakeFromPicker as boolean | undefined,
    createdAt: String(row['created_at'] ?? row['createdAt'] ?? new Date().toISOString()),
  };
}

export function resolveInboundAgentForChannel(channel: ChannelBindingId): Agent {
  const eng = getEngine();
  // Bindings link desktop context per channel — each surface has its own transcript session.
  autoBindChannelToUiSession(eng, channel);
  syncChannelSuperSessionContext(eng, channel);
  return ensureChannelAgent(channel);
}

export function registerChannelInboundRouting(): void {
  setChannelInboundAgentResolver((channelId) => {
    try {
      return resolveInboundAgentForChannel(channelId as ChannelBindingId);
    } catch {
      return null;
    }
  });
}

export function initChannelSessionBridge(): void {
  registerChannelInboundRouting();
  try {
    const eng = getEngine();
    propagateTelegramConnectedToAgents(eng);
    void pruneChannelCoveredMcpConnections(eng).catch(() => { /* engine warming */ });
  } catch { /* engine not ready */ }
}

export function maybeAugmentChatInstruction(
  eng: ReturnType<typeof getEngine>,
  sessionId: string,
  text: string,
  instruction?: string,
): string | undefined {
  if (!isContinuationTrigger(text)) return instruction;
  const block = buildContinueTurnInstruction(eng, sessionId, text);
  if (!block) return instruction;
  return instruction ? `${instruction}\n\n${block}` : block;
}
