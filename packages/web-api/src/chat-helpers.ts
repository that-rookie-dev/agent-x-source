import type { Agent } from '@agentx/engine';
import { applyWebSearchConfigFromAgentConfig, getPersonaStore, isWebSearchAvailableForChat } from '@agentx/engine';
import type { AgentPersonaConfig, AgentXConfig, ClientSituation, Message, StorageAdapter, StorableMessage, TurnAttachment } from '@agentx/shared';
import { normalizeClientSituation } from '@agentx/shared';
import { getEngine } from './engine.js';
import { persistMessageDirect } from './ws.js';
import { turnRegistry } from './turn-registry.js';
import { getLogger, sanitizeForJson, generateId } from '@agentx/shared';

const SESSION_HYDRATE_TIMEOUT_MS = 3_000;

/** Best-effort session hydrate — must never block chat/voice turns indefinitely. */
export async function ensureSessionHydratedForTurn(
  store: StorageAdapter | null | undefined,
  sessionId: string,
): Promise<void> {
  if (!sessionId || !store || typeof store.ensureSessionHydrated !== 'function') return;
  try {
    await Promise.race([
      Promise.resolve(store.ensureSessionHydrated(sessionId)),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('session hydrate timeout')), SESSION_HYDRATE_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    getLogger().warn(
      'SESSION_HYDRATE',
      `${sessionId}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export const TURN_TIMEOUT_MS = 600_000;
/**
 * Idle cap for voice comms turns: if the agent produces NO activity
 * (tool/step/heartbeat/stream) for this long, the turn is aborted. Activity
 * resets the clock so tool-heavy hands-free turns aren't killed mid-work.
 */
/** Idle timeout for voice — if the provider never streams, fail the turn (was 90s of stuck Thinking…). */
export const VOICE_TURN_TIMEOUT_MS = 45_000;
/** Hard ceiling for a single voice turn regardless of ongoing activity. */
export const VOICE_TURN_MAX_MS = 120_000;

export function getForceWebSearchError(cfg: AgentXConfig, forceWebSearch?: boolean): string | null {
  if (!forceWebSearch) return null;
  applyWebSearchConfigFromAgentConfig(cfg);
  if (!isWebSearchAvailableForChat(cfg).available) {
    return 'Web search is not available. Enable a search provider in Settings → Tools.';
  }
  return null;
}

export function isCrewPrivateSessionRecord(session: { contextKind?: string } | null | undefined): boolean {
  return (session?.contextKind ?? 'agent_x') === 'crew_private';
}

export function buildFullText(text: string, attachments?: { name: string; content: string }[]): string {
  const safeText = sanitizeForJson(text);
  if (!attachments?.length) return safeText;
  const attachmentSection = attachments.map((a) => `\n\n--- File: ${a.name} ---\n${sanitizeForJson(a.content)}`).join('');
  return safeText + attachmentSection;
}

function buildCrewPrivateInstruction(): string {
  return `PRIVATE CHAT — conversational specialist mode.

- Deliver complete plans, itineraries, analysis, and expertise as rich markdown IN THIS CHAT.
- Planning is internal reasoning between you and the system — NEVER ask the user to approve a plan in a modal.
- Do NOT tell the user to switch tools for conversational deliverables (travel plans, advice, outlines, questionnaires).
- After the last questionnaire answer, include the FULL plan or response in the same turn — never stop at a transition phrase.
- Use read/analysis tools when they genuinely help your domain expertise.
- Only mention tool execution if they explicitly asked you to write files or run commands on their machine.`;
}

export function buildAgentInstruction(): string {
  return `🛡️ AUTONOMOUS DIAGNOSTICS PROTOCOL

You have access to an intelligent file resolution system that automatically handles file path errors:

SELF-HEALING CAPABILITIES:
- When a file path is not found, the system automatically searches for it across common locations
- File resolution uses fuzzy matching (40%+ confidence threshold) to find the best match
- Resolved files are automatically retried without requiring your intervention
- UI will show "[🔧 SELF-CORRECTED] Operation completed" when auto-healing succeeds

YOUR RESPONSIBILITIES:
- If a file operation fails AFTER auto-healing attempt, inform the user with the attempted paths
- Do NOT ask the user to specify full paths—the system can find files by name alone
- Trust the auto-healing system; do not retry failed operations yourself`;
}

export function refreshAgentPersona(agent: Agent): void {
  try {
    const persona = getPersonaStore().get();
    const current = agent.getPersona();
    if (JSON.stringify(persona) === JSON.stringify(current)) return;
    agent.applyPersona(persona);
  } catch { /* best-effort */ }
}

export function applyClientSituation(agent: Agent, situation: unknown): ClientSituation | null {
  const normalized = normalizeClientSituation(situation);
  if (normalized) {
    agent.setClientSituation(normalized);
  }
  return normalized;
}

export function buildTurnInstruction(opts?: { crewPrivate?: boolean }): string | undefined {
  if (opts?.crewPrivate) {
    return buildCrewPrivateInstruction();
  }
  return buildAgentInstruction();
}

export function persistToolLedger(agent: Agent, sessionId: string): void {
  try {
    const ledger = agent.getToolLedgerContent?.() ?? '';
    if (ledger) {
      persistMessageDirect(sessionId, 'system', ledger);
    }
  } catch { /* best-effort */ }
}

export const TURN_ACTIVITY_EVENTS = new Set([
  'turn_heartbeat',
  'tool_executing',
  'tool_complete',
  'tool_called',
  'tool_result',
  'stream_chunk',
  'step_start',
  'step_finish',
  'operation_file_edited',
]);

const activeTurnBySession = new Map<string, string>();

export function registerActiveTurn(sessionId: string, turnId: string): void {
  activeTurnBySession.set(sessionId, turnId);
}

export function clearActiveTurn(sessionId: string, turnId?: string): void {
  if (!turnId || activeTurnBySession.get(sessionId) === turnId) {
    activeTurnBySession.delete(sessionId);
  }
}

/** Cancel the in-flight turn for a session (Stop button). Returns the turn id if one was active. */
export function cancelActiveSessionTurn(sessionId: string): string | undefined {
  const turnId = activeTurnBySession.get(sessionId);
  if (turnId) {
    turnRegistry.cancel(turnId);
    activeTurnBySession.delete(sessionId);
  }
  return turnId;
}

export function runAgentTurnAsync(
  agent: Agent,
  fullText: string,
  instruction: string | undefined,
  retry: boolean | undefined,
  turnId: string,
  sessionId: string,
  onComplete?: (message: unknown) => void,
  onError?: (error: string, partial?: string) => void,
  delegateCrewIds?: string[],
  crewSuggestionResolved?: boolean,
  crewIntakeFromPicker?: boolean,
  primaryCrewId?: string,
  extra?: {
    forceWebSearch?: boolean;
    voiceTurn?: boolean;
    turnTimeoutMs?: number;
    fixedTurnTimeout?: boolean;
    /** Hard ceiling (ms) that fires even while activity keeps resetting the idle clock. */
    maxTurnMs?: number;
    userMessagePersisted?: boolean;
    voiceContinuation?: boolean;
    voiceMergeIntoMessage?: { messageId: string; prefixContent: string };
    resumeCrewIntake?: {
      originalUserText: string;
      intakeAnswer: string;
      delegateCrewIds: string[];
      primaryCrewId?: string;
    };
    clientSituation?: ClientSituation | null;
    crewSuggestionRequested?: boolean;
    signal?: AbortSignal;
    /** Resolved user attachments (storage id + metadata). */
    attachments?: TurnAttachment[];
  },
): void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let maxTurnTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutPaused = false;
  const turnTimeoutMs = extra?.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const fixedTurnTimeout = extra?.fixedTurnTimeout ?? false;
  const maxTurnMs = extra?.maxTurnMs;

  if (extra?.voiceTurn) {
    try {
      agent.getToolExecutor()?.setVoiceTurnActive?.(true);
    } catch { /* best-effort */ }
  }

  registerActiveTurn(sessionId, turnId);

  const clearVoiceTurn = () => {
    if (!extra?.voiceTurn) return;
    try {
      agent.getToolExecutor()?.setVoiceTurnActive?.(false);
    } catch { /* best-effort */ }
  };

  const pauseTimeout = () => {
    timeoutPaused = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    // Human-in-the-loop (clarification/permission) shouldn't burn the hard ceiling.
    if (maxTurnTimer) {
      clearTimeout(maxTurnTimer);
      maxTurnTimer = undefined;
    }
  };

  let turnCompleted = false;
  const clearTimers = () => {
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
    if (maxTurnTimer) { clearTimeout(maxTurnTimer); maxTurnTimer = undefined; }
  };
  const finalizeTurn = () => {
    clearActiveTurn(sessionId, turnId);
    clearTimers();
    unsubActivity();
    clearVoiceTurn();
  };
  const onTimeout = () => {
    if (turnCompleted) return;
    try {
      if (agent.isAwaitingClarification?.()) {
        agent.abortClarificationWait?.();
      }
      agent.cancel();
      turnCompleted = true;
      finalizeTurn();
      const partial = agent.getPartialTurnContent?.() ?? '';
      turnRegistry.fail(turnId, 'The operation was aborted due to timeout', partial);
      if (partial) {
        persistMessageDirect(sessionId, 'assistant', partial + '\n\n⚠ Turn timed out — partial output saved.');
      }
      onError?.('The operation was aborted due to timeout', partial);
    } catch { /* best-effort */ }
  };
  const scheduleTimeout = () => {
    if (timeoutPaused || fixedTurnTimeout) return;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(onTimeout, turnTimeoutMs);
  };
  const unsubActivity = agent.events.on((event) => {
    const type = event.type as string;
    if (type === 'clarification_required' || type === 'permission_required') {
      // Human-in-the-loop: stop the clock until they respond (voice or UI).
      pauseTimeout();
      return;
    }
    if (type === 'loading_start') {
      const stage = (event as { stage?: string }).stage;
      if (timeoutPaused && (stage === 'thinking' || stage === 'crew_private')) {
        timeoutPaused = false;
        scheduleTimeout();
      }
      return;
    }
    if (timeoutPaused && TURN_ACTIVITY_EVENTS.has(type)) {
      // A permission/clarification was resolved and work resumed — restart the clock.
      timeoutPaused = false;
      if (fixedTurnTimeout) {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(onTimeout, turnTimeoutMs);
      } else {
        scheduleTimeout();
      }
      if (maxTurnMs && maxTurnMs > 0 && !maxTurnTimer) {
        maxTurnTimer = setTimeout(onTimeout, maxTurnMs);
      }
      return;
    }
    if (!fixedTurnTimeout && TURN_ACTIVITY_EVENTS.has(type)) {
      scheduleTimeout();
    }
  });
  timeoutId = setTimeout(onTimeout, turnTimeoutMs);
  if (maxTurnMs && maxTurnMs > 0) {
    // Hard ceiling: fires regardless of activity or idle-clock resets.
    maxTurnTimer = setTimeout(onTimeout, maxTurnMs);
  }

  refreshAgentPersona(agent);
  const clientSituation = extra?.clientSituation ?? null;
  if (clientSituation) {
    agent.setClientSituation(clientSituation);
  }

  void agent.sendMessage(fullText, {
    ...(instruction ? { instruction } : {}),
    ...(retry ? { retry: true } : {}),
    ...(delegateCrewIds?.length ? { delegateCrewIds } : {}),
    ...(crewSuggestionResolved ? { crewSuggestionResolved: true } : {}),
    ...(crewIntakeFromPicker ? { crewIntakeFromPicker: true } : {}),
    ...(primaryCrewId ? { primaryCrewId } : {}),
    ...(extra?.forceWebSearch ? { forceWebSearch: true } : {}),
    ...(extra?.voiceTurn ? { voiceTurn: true } : {}),
    ...(extra?.userMessagePersisted ? { userMessagePersisted: true } : {}),
    ...(extra?.voiceContinuation ? { voiceContinuation: true } : {}),
    ...(extra?.voiceMergeIntoMessage ? { voiceMergeIntoMessage: extra.voiceMergeIntoMessage } : {}),
    ...(extra?.resumeCrewIntake ? { resumeCrewIntake: extra.resumeCrewIntake } : {}),
    ...(clientSituation ? { clientSituation } : {}),
    ...(extra?.crewSuggestionRequested ? { crewSuggestionRequested: true } : {}),
    ...(extra?.signal ? { signal: extra.signal } : {}),
    ...(extra?.attachments ? { attachments: extra.attachments } : {}),
  })
    .then((message) => {
      turnCompleted = true;
      finalizeTurn();
      persistToolLedger(agent, sessionId);
      if (!message) {
        turnRegistry.complete(turnId, message as Message);
        onComplete?.(message as Message);
        return;
      }
      if (message.id === '__clarify__') {
        turnRegistry.complete(turnId, message);
        onComplete?.(message);
        return;
      }
      turnRegistry.complete(turnId, message);
      try { getEngine().sessionManager.updateSession({ updatedAt: new Date().toISOString() }); } catch { /* best-effort */ }
      onComplete?.(message);
    })
    .catch((e: unknown) => {
      turnCompleted = true;
      finalizeTurn();
      const isAbort = e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message));
      if (isAbort) {
        const partial = agent.getPartialTurnContent?.() ?? '';
        turnRegistry.cancel(turnId);
        persistToolLedger(agent, sessionId);
        onError?.('Cancelled', partial);
        return;
      }
      const errMsg = e instanceof Error ? e.message : 'chat-failed';
      const partial = agent.getPartialTurnContent?.() ?? '';
      turnRegistry.fail(turnId, errMsg, partial);
      persistToolLedger(agent, sessionId);
      if (partial) {
        try { persistMessageDirect(sessionId, 'assistant', partial); } catch { /* best-effort */ }
      }
      getLogger().error('CHAT_TURN_ASYNC', e instanceof Error ? e : String(e));
      onError?.(errMsg, partial);
    });
}

type TurnFeedbackStoreLike = {
  upsertTurnFeedback?: (feedback: Record<string, unknown>) => void;
  getTurnFeedbackBySession?: (sessionId: string) => Array<Record<string, unknown>>;
};

export function getSessionStore(): StorageAdapter | null {
  const eng = getEngine();
  return eng.sessionManager?.getStorageAdapter() ?? null;
}

export function getMessageStore(): StorageAdapter | null {
  const eng = getEngine();
  return eng.sessionManager?.getStorageAdapter() ?? null;
}

export async function loadSessionMessagesPage(
  sessionId: string,
  opts: { limit?: number; before?: string },
): Promise<{ messages: Array<Record<string, unknown> | StorableMessage>; total: number; hasMore: boolean }> {
  const store = getMessageStore();
  if (!store) return { messages: [], total: 0, hasMore: false };

  await store.ensureSessionHydrated?.(sessionId);

  if (store.getMessagesPage) {
    return await store.getMessagesPage(sessionId, opts);
  }

  const all = (store.getMessages?.(sessionId) ?? [])
    .filter((m) => m['role'] === 'user' || m['role'] === 'assistant');
  const total = all.length;
  let slice = all;
  if (opts.before) {
    const idx = all.findIndex((m) => m['id'] === opts.before);
    slice = idx > 0 ? all.slice(0, idx) : [];
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const messages = slice.slice(-limit);
  const hasMore = slice.length > limit || (opts.before ? all.findIndex((m) => m['id'] === opts.before) > limit : total > limit);
  return { messages, total, hasMore };
}

export function loadTurnFeedbackForSession(_eng: ReturnType<typeof getEngine>, sessionId: string): Array<Record<string, unknown>> {
  const store = getSessionStore();
  if (!store?.getTurnFeedbackBySession) return [];
  try {
    return store.getTurnFeedbackBySession(sessionId);
  } catch {
    return [];
  }
}

export function recordTurnFeedback(input: {
  sessionId: string;
  messageId: string;
  rating: 'positive' | 'negative' | 'skipped';
  contextKind: 'agent_x' | 'crew_private';
  crewId?: string | null;
  turnSummary?: string | null;
  metadata?: Record<string, unknown> | null;
}): { ok: true } | { ok: false; error: string } {
  const eng = getEngine();
  const agent = eng.agent;
  const service = agent?.turnFeedbackService;
  if (!service) {
    const store = getSessionStore();
    if (!store?.upsertTurnFeedback) return { ok: false, error: 'store-unavailable' };
    store.upsertTurnFeedback({
      id: generateId(),
      sessionId: input.sessionId,
      messageId: input.messageId,
      contextKind: input.contextKind,
      crewId: input.crewId ?? null,
      rating: input.rating,
      turnSummary: input.turnSummary ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    });
  } else {
    service.record({
      sessionId: input.sessionId,
      messageId: input.messageId,
      contextKind: input.contextKind,
      crewId: input.crewId ?? null,
      rating: input.rating,
      turnSummary: input.turnSummary ?? null,
      metadata: input.metadata ?? null,
    });
  }

  if (input.rating === 'positive' || input.rating === 'negative') {
    if (input.crewId) {
      try {
        agent?.recordCrewFeedback?.(input.crewId, input.rating === 'positive');
      } catch { /* best-effort */ }
    }
  }

  try {
    const agent = getEngine().agent as Agent | null;
    agent?.rebuildSystemPrompt?.();
  } catch { /* best-effort */ }

  return { ok: true };
}
