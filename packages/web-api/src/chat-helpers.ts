import type { Agent } from '@agentx/engine';
import { applyWebSearchConfigFromAgentConfig, isWebSearchAvailableForChat } from '@agentx/engine';
import type { AgentXConfig } from '@agentx/shared';
import { getEngine } from './engine.js';
import { persistMessageDirect } from './ws.js';
import { turnRegistry } from './turn-registry.js';
import { getLogger, sanitizeForJson, generateId } from '@agentx/shared';

export const TURN_TIMEOUT_MS = 600_000;
/** Wall-clock cap for voice comms modal turns (no heartbeat extension). */
export const VOICE_TURN_TIMEOUT_MS = 90_000;

export function getForceWebSearchError(cfg: AgentXConfig, forceWebSearch?: boolean): string | null {
  if (!forceWebSearch) return null;
  applyWebSearchConfigFromAgentConfig(cfg);
  if (!isWebSearchAvailableForChat(cfg).available) {
    return 'Web search is not available. Enable a search provider in Settings → Tools.';
  }
  return null;
}

export const sessionSettings: { mode: 'agent' | 'plan' } = { mode: 'plan' };

export function isCrewPrivateSessionRecord(session: { contextKind?: string } | null | undefined): boolean {
  return (session?.contextKind ?? 'agent_x') === 'crew_private';
}

/** Sync global sessionSettings from active session record (per-session mode). */
export function applySessionModeToAgent(agent: Agent): 'agent' | 'plan' {
  // Hyperdrive is an overlay — keep agent in build mode and use agent instructions
  if (agent.hyperdriveMode) {
    return 'agent';
  }
  const eng = getEngine();
  try {
    const sess = eng.sessionManager.getActiveSession?.() as { mode?: string; contextKind?: string } | null | undefined;
    if (sess?.mode === 'agent' || sess?.mode === 'plan') {
      sessionSettings.mode = sess.mode;
    }
  } catch { /* best-effort */ }
  agent.setPlanMode(sessionSettings.mode === 'plan');
  return sessionSettings.mode;
}

export function buildFullText(text: string, attachments?: { name: string; content: string }[]): string {
  const safeText = sanitizeForJson(text);
  if (!attachments?.length) return safeText;
  const attachmentSection = attachments.map((a) => `\n\n--- File: ${a.name} ---\n${sanitizeForJson(a.content)}`).join('');
  return safeText + attachmentSection;
}

export function buildPlanInstruction(): string {
  return `🔒 PLAN MODE

Plan mode allows reads, web search, new file creation, shell/scripts, notifications, and automation scheduling.

REQUIRES AGENT MODE OR HYPERDRIVE (edits/deletes only):
- Editing existing files (file_edit, code_replace, apply_patch, json_set, …)
- Deleting files, folders, or todos
- Destructive git operations (reset, rebase, merge, stash)

AVAILABLE IN PLAN MODE:
- file_read, glob, grep, web_search, deep_web_search, automation_register, bash, file_write (new files), doc_markdown, notify_desktop, memory_store, and most create/execute tools

SCHEDULING:
- For reminders or "at <time>" / "in X minutes" tasks: call automation_register FIRST — do NOT research now.
- automation_register works in Plan mode without switching modes.

IF USER ASKS TO EDIT OR DELETE EXISTING FILES:
1. Acknowledge the request
2. Explain that edit/delete requires Agent mode or Hyperdrive
3. Offer to plan the steps in chat, or ask them to switch modes for the edit

Do NOT ask to switch modes for: web search, scheduling, new file creation, scripts, or read-only analysis.`;
}

export function buildCrewPrivatePlanInstruction(): string {
  return `CREW PRIVATE CHAT — conversational specialist mode.

- Deliver complete plans, itineraries, analysis, and expertise as rich markdown IN THIS CHAT.
- Planning is internal reasoning between you and the system — NEVER ask the user to approve a plan in a modal.
- Do NOT tell the user to switch to Agent mode for conversational deliverables (travel plans, advice, outlines, questionnaires).
- After the last questionnaire answer, include the FULL plan or response in the same turn — never stop at a transition phrase.
- Use read/analysis tools when they genuinely help your domain expertise.
- Only mention Agent mode if they explicitly asked you to write files or run commands on their machine.`;
}

export function buildAgentInstruction(): string {
  return `🛡️ AUTONOMOUS DIAGNOSTICS PROTOCOL (Agent Mode)

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

export function buildInstructionForMode(
  mode: 'agent' | 'plan',
  opts?: { crewPrivate?: boolean },
): string | undefined {
  if (opts?.crewPrivate) {
    return mode === 'plan' ? buildCrewPrivatePlanInstruction() : undefined;
  }
  return mode === 'plan' ? buildPlanInstruction() : buildAgentInstruction();
}

export function persistToolLedger(agent: Agent, sessionId: string): void {
  try {
    const ledger = (agent as unknown as { getToolLedgerContent?: () => string }).getToolLedgerContent?.() ?? '';
    if (ledger) {
      persistMessageDirect(sessionId, 'system', ledger);
    }
  } catch { /* best-effort */ }
}

const TURN_ACTIVITY_EVENTS = new Set([
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
    userMessagePersisted?: boolean;
    voiceContinuation?: boolean;
    voiceMergeIntoMessage?: { messageId: string; prefixContent: string };
    resumeCrewIntake?: {
      originalUserText: string;
      intakeAnswer: string;
      delegateCrewIds: string[];
      primaryCrewId?: string;
    };
  },
): void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timeoutPaused = false;
  const turnTimeoutMs = extra?.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const fixedTurnTimeout = extra?.fixedTurnTimeout ?? false;

  if (extra?.voiceTurn) {
    try {
      agent.getToolExecutor()?.setVoiceTurnActive?.(true);
    } catch { /* best-effort */ }
  }

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
  };

  let turnCompleted = false;
  const onTimeout = () => {
    if (turnCompleted) return;
    try {
      if (agent.isAwaitingClarification?.()) {
        agent.abortClarificationWait?.();
      }
      agent.cancel();
      const partial = (agent as unknown as { getPartialTurnContent?: () => string }).getPartialTurnContent?.() ?? '';
      turnRegistry.fail(turnId, 'The operation was aborted due to timeout', partial);
      if (partial) {
        persistMessageDirect(sessionId, 'assistant', partial + '\n\n⚠ Turn timed out — partial output saved.');
      }
      clearVoiceTurn();
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
      return;
    }
    if (!fixedTurnTimeout && TURN_ACTIVITY_EVENTS.has(type)) {
      scheduleTimeout();
    }
  });
  timeoutId = setTimeout(onTimeout, turnTimeoutMs);

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
  })
    .then((message) => {
      turnCompleted = true;
      if (timeoutId) clearTimeout(timeoutId);
      unsubActivity();
      clearVoiceTurn();
      persistToolLedger(agent, sessionId);
      if (!message || (message as unknown as Record<string, unknown>).id === '__clarify__') {
        turnRegistry.complete(turnId, message as any);
        onComplete?.(message);
        return;
      }
      turnRegistry.complete(turnId, message);
      try { getEngine().sessionManager.updateSession({ updatedAt: new Date().toISOString() } as any); } catch { /* best-effort */ }
      onComplete?.(message);
    })
    .catch((e: unknown) => {
      turnCompleted = true;
      if (timeoutId) clearTimeout(timeoutId);
      unsubActivity();
      clearVoiceTurn();
      const errMsg = e instanceof Error ? e.message : 'chat-failed';
      const partial = (agent as unknown as { getPartialTurnContent?: () => string }).getPartialTurnContent?.() ?? '';
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

export function getSessionStore(): TurnFeedbackStoreLike | null {
  const eng = getEngine();
  return (eng.sessionManager as unknown as { store?: TurnFeedbackStoreLike })?.store ?? null;
}

type MessagePageStore = {
  getMessagesPage?: (
    sessionId: string,
    opts: { limit?: number; before?: string },
  ) => { messages: Array<Record<string, unknown>>; total: number; hasMore: boolean } | Promise<{ messages: Array<Record<string, unknown>>; total: number; hasMore: boolean }>;
  getMessages?: (sessionId: string) => Array<Record<string, unknown>>;
  getParts?: (sessionId: string) => Array<Record<string, unknown>>;
  getPartsForMessages?: (sessionId: string, messages: Array<Record<string, unknown>>) => Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
};

export function getMessageStore(): MessagePageStore | null {
  const eng = getEngine();
  return (eng.sessionManager as unknown as { store?: MessagePageStore })?.store ?? null;
}

export async function loadSessionMessagesPage(
  sessionId: string,
  opts: { limit?: number; before?: string },
): Promise<{ messages: Array<Record<string, unknown>>; total: number; hasMore: boolean }> {
  const store = getMessageStore();
  if (!store) return { messages: [], total: 0, hasMore: false };

  if ('ensureSessionHydrated' in store && typeof (store as { ensureSessionHydrated?: (id: string) => Promise<void> }).ensureSessionHydrated === 'function') {
    await (store as { ensureSessionHydrated: (id: string) => Promise<void> }).ensureSessionHydrated(sessionId);
  }

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
  const agent = eng.agent as Agent | null;
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
        (agent as Agent & { recordCrewFeedback?: (crewId: string, positive: boolean) => void })?.recordCrewFeedback?.(input.crewId, input.rating === 'positive');
      } catch { /* best-effort */ }
    }
    try {
      const exp = agent as unknown as { experienceEngine?: { recordTrial: (sid: string, trial: Record<string, unknown>) => void } } | null;
      exp?.experienceEngine?.recordTrial(input.sessionId, {
        category: 'user_feedback',
        action: input.turnSummary || 'assistant_turn',
        result: input.rating === 'positive' ? 'success' : 'failure',
        reward: input.rating === 'positive' ? 1 : -1,
        metadata: { messageId: input.messageId, crewId: input.crewId, contextKind: input.contextKind },
      });
    } catch { /* best-effort neural sync */ }
  }

  try {
    const agent = getEngine().agent as Agent | null;
    agent?.rebuildSystemPrompt?.();
  } catch { /* best-effort */ }

  return { ok: true };
}
