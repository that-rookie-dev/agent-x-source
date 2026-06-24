import type { Response } from 'express';
import type { Agent } from '@agentx/engine';
import { createAgent, destroyAgent, destroyCrewChatService, getEngine } from './engine.js';
import { ensureSubscribed, persistMessageDirect } from './ws.js';
import { turnRegistry } from './turn-registry.js';
import { getLogger, sanitizeForJson } from '@agentx/shared';

export const TURN_TIMEOUT_MS = 600_000;

export const sessionSettings: { mode: 'agent' | 'plan' } = { mode: 'plan' };

/** Sync global sessionSettings from active session record (per-session mode). */
export function applySessionModeToAgent(agent: Agent): 'agent' | 'plan' {
  // Hyperdrive is an overlay — keep agent in build mode and use agent instructions
  if (agent.hyperdriveMode) {
    return 'agent';
  }
  const eng = getEngine();
  try {
    const sess = eng.sessionManager.getActiveSession?.() as { mode?: string } | null | undefined;
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
  return `🔒 CRITICAL CONSTRAINT: PLAN MODE (READ-ONLY)

You are operating in PLAN MODE. This means:

UNAVAILABLE: file writes, shell commands, doc_markdown, python_rpc, notifications, and any mutating tools
AVAILABLE: file_read, glob, grep, web_search, code_search, and other read/analysis tools

YOU CANNOT and MUST NOT:
- Create, write, or modify files (including .md plan documents on disk)
- Delete or rename files
- Execute shell commands
- Claim you did any of the above

IF USER ASKS YOU TO CREATE/WRITE/MODIFY FILES:
1. Acknowledge the request
2. Deliver a detailed PLAN as markdown IN THIS CHAT MESSAGE ONLY
3. Tell them: "To execute this, switch to Agent mode or engage Hyperdrive"
4. Do NOT pretend the action succeeded

You can only ANALYZE, READ, SEARCH, and PLAN in chat. You cannot EXECUTE modifications.`;
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

export function buildInstructionForMode(mode: 'agent' | 'plan'): string | undefined {
  return mode === 'plan' ? buildPlanInstruction() : buildAgentInstruction();
}

/** Activate the canonical crew-private session on the shared Agent (same stack as session chat). */
export function ensureCrewPrivateAgentForSession(sessionId: string): Agent {
  const eng = getEngine();
  let session = eng.sessionManager.getSessionById(sessionId);
  if (!session || (session.contextKind ?? 'agent_x') !== 'crew_private') {
    throw new Error('not-crew-private-session');
  }

  const hostCrewId = session.hostCrewId as string | undefined;
  if (hostCrewId) {
    const mgr = eng.sessionManager as unknown as {
      resolveCanonicalCrewPrivateSession?: (id: string) => typeof session | null;
      findCrewPrivateSession?: (id: string) => typeof session | null;
    };
    const canonical = mgr.resolveCanonicalCrewPrivateSession?.(hostCrewId)
      ?? mgr.findCrewPrivateSession?.(hostCrewId);
    if (canonical && canonical.id !== session.id) session = canonical;
  }

  const targetId = session.id;
  const current = eng.agent;
  if (current && (current as unknown as { sessionId?: string }).sessionId === targetId) {
    return current;
  }

  destroyCrewChatService(targetId);
  destroyAgent();
  const restored = eng.sessionManager.restoreSession(targetId);
  if (!restored) throw new Error('not-found');

  sessionSettings.mode = restored.mode === 'agent' ? 'agent' : 'plan';
  createAgent(undefined, restored);
  ensureSubscribed();

  if (!eng.agent) throw new Error('agent-create-failed');
  return eng.agent;
}

export type AgentMessageStreamOptions = {
  text: string;
  attachments?: { name: string; content: string }[];
  retry?: boolean;
  skipCrewSuggestion?: boolean;
  connectedPayload?: Record<string, unknown>;
};

/** Shared SSE handler for Agent-backed chat turns (session chat + crew private). */
export async function handleAgentMessageStream(
  res: Response,
  agent: Agent,
  opts: AgentMessageStreamOptions,
  evaluateCrewSuggestion?: (args: { text: string; sessionId: string }) => Promise<{ shouldSuggest: boolean } | null>,
): Promise<void> {
  if (agent.processing) {
    try { agent.cancel(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 100));
    if (agent.processing) {
      res.status(503).json({ error: 'Agent is busy. Please try again in a moment.' });
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let eventId = 0;
  const sendEvent = (event: string, data: unknown) => {
    try {
      res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      eventId++;
    } catch { /* connection closed */ }
  };

  sendEvent('connected', opts.connectedPayload ?? { timestamp: new Date().toISOString() });

  const eng = getEngine();
  const mode = applySessionModeToAgent(agent);

  if (opts.retry) {
    try {
      const store = (eng.sessionManager as unknown as { store?: { deleteLastMessages?: (id: string, n: number, roles?: string[]) => void } }).store;
      const sid = (agent as unknown as { sessionId: string }).sessionId;
      if (store?.deleteLastMessages && sid) {
        store.deleteLastMessages(sid, 2, ['user', 'assistant']);
      }
      try { agent.rebuildContext(); } catch { /* best-effort */ }
    } catch { /* best-effort */ }
  }

  const fullText = buildFullText(opts.text, opts.attachments);
  const instruction = buildInstructionForMode(mode);

  try {
    const store = (eng.sessionManager as unknown as { store?: { createCheckpoint?: (id: string, label: string) => void } }).store;
    const sid = (agent as unknown as { sessionId: string }).sessionId;
    if (store?.createCheckpoint && sid) {
      store.createCheckpoint(sid, `Auto · ${new Date().toLocaleTimeString()}`);
    }
  } catch { /* best-effort */ }

  const unsub = eng.telemetry.onEvent((ev) => {
    sendEvent('progress', ev);
  });

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { clearInterval(heartbeat); unsub(); }
  }, 25000);

  const sid = (agent as unknown as { sessionId: string }).sessionId;
  const turn = turnRegistry.create(sid);
  let finished = false;

  const poll = setInterval(() => {
    if (finished) return;
    const record = turnRegistry.get(turn.turnId);
    if (!record) return;
    if (record.status === 'complete') {
      finished = true;
      clearInterval(poll);
      if ((record.message as Record<string, unknown> | undefined)?.id === '__clarify__') {
        sendEvent('clarification', { ok: true });
      } else {
        sendEvent('complete', { ok: true, message: record.message, turnId: turn.turnId });
      }
      clearInterval(heartbeat);
      unsub();
      res.end();
    } else if (record.status === 'error' || record.status === 'cancelled') {
      finished = true;
      clearInterval(poll);
      sendEvent('error', { error: record.error ?? 'chat-failed', code: 'PROCESSING_FAILED', partialContent: record.partialContent });
      clearInterval(heartbeat);
      unsub();
      res.end();
    }
  }, 500);

  const cleanup = () => {
    finished = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    unsub();
    try { agent.cancel(); } catch { /* ignore */ }
  };

  res.on('close', cleanup);

  if (!opts.skipCrewSuggestion && evaluateCrewSuggestion && sid && !/(?<!\w)@([\w][\w.-]*)/.test(fullText)) {
    try {
      const evaluation = await evaluateCrewSuggestion({ text: fullText, sessionId: sid });
      if (evaluation?.shouldSuggest) {
        sendEvent('crew_suggestion', { evaluation, message: fullText });
      }
    } catch { /* best-effort */ }
  }

  runAgentTurnAsync(agent, fullText, instruction, opts.retry, turn.turnId, sid);
  sendEvent('started', { turnId: turn.turnId, async: true });
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
  'message_received',
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
): void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const onTimeout = () => {
    try {
      agent.cancel();
      const partial = (agent as unknown as { getPartialTurnContent?: () => string }).getPartialTurnContent?.() ?? '';
      turnRegistry.fail(turnId, 'The operation was aborted due to timeout', partial);
      if (partial) {
        persistMessageDirect(sessionId, 'assistant', partial + '\n\n⚠ Turn timed out — partial output saved.');
      }
      onError?.('The operation was aborted due to timeout', partial);
    } catch { /* best-effort */ }
  };
  const scheduleTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(onTimeout, TURN_TIMEOUT_MS);
  };
  const unsubActivity = agent.events.on((event) => {
    if (TURN_ACTIVITY_EVENTS.has(event.type as string)) {
      scheduleTimeout();
    }
  });
  scheduleTimeout();

  void agent.sendMessage(fullText, {
    ...(instruction ? { instruction } : {}),
    ...(retry ? { retry: true } : {}),
    ...(delegateCrewIds?.length ? { delegateCrewIds } : {}),
  })
    .then((message) => {
      if (timeoutId) clearTimeout(timeoutId);
      unsubActivity();
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
      if (timeoutId) clearTimeout(timeoutId);
      unsubActivity();
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
