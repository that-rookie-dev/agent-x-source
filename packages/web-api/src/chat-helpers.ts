import type { Agent } from '@agentx/engine';
import { getEngine } from './engine.js';
import { persistMessageDirect } from './ws.js';
import { turnRegistry } from './turn-registry.js';
import { getLogger, sanitizeForJson, stripToolNoise, type MessagePart } from '@agentx/shared';

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

  void agent.sendMessage(fullText, { ...(instruction ? { instruction } : {}), ...(retry ? { retry: true } : {}) })
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
