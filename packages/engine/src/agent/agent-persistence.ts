/**
 * Session persistence helpers extracted from Agent.ts (REFACTOR-2).
 *
 * These standalone functions accept a `PersistenceContext` (the slice of
 * AgentFacade they need) instead of `this`, preserving all original behavior.
 */
import type {
  Message,
  StorageAdapter,
  PermissionDecision,
  QuestionnaireRecord,
  CompletionMessage,
} from '@agentx/shared';
import {
  generateMessageId,
  parseChannelBindingFromSessionId,
  mergeChannelLinkedMessages,
  resolveChannelResumeStateSessionId,
  resolveContinuationInstruction,
  detectIncompleteLastTurn,
  isContinuationTrigger,
  type SessionResumeState,
} from '@agentx/shared';
import type { SessionManager } from '../session/SessionManager.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import type { AgentOptions } from './Agent.js';
import { isFailureAssistantContent } from './agent-helpers.js';

/** Slice of AgentFacade required by the persistence helpers. */
export interface PersistenceContext {
  sessionId: string;
  messages: CompletionMessage[];
  sessionManager: SessionManager | null;
  activeInboundChannel: string | null;
  linkedContextSessionId: string | null;
  toolExecutor: ToolExecutor | EnhancedToolExecutor | undefined;
  options: Readonly<AgentOptions>;
  getPersistStore(): StorageAdapter | null;
}

// ─── Resume-state helpers ───

export function parseStoredResumeState(row: Record<string, unknown> | null | undefined): SessionResumeState | null {
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

export function loadAuthoritativeMessages(
  ctx: PersistenceContext,
): Array<{ role?: string; content?: string; parts?: unknown }> {
  const store = ctx.getPersistStore();
  if (store?.getMessages) {
    if (ctx.options.channelSession && ctx.linkedContextSessionId) {
      const linked = store.getMessages(ctx.linkedContextSessionId);
      const channel = store.getMessages(ctx.sessionId);
      return mergeChannelLinkedMessages(linked, channel);
    }
    return store.getMessages(ctx.sessionId);
  }
  return ctx.messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '',
  }));
}

export function resolveContinuationResumeState(ctx: PersistenceContext): SessionResumeState | null {
  const store = ctx.getPersistStore();
  if (!store?.getSessionResumeState) return null;
  const resumeSessionId = ctx.options.channelSession
    ? resolveChannelResumeStateSessionId(ctx.sessionId, ctx.linkedContextSessionId)
    : ctx.sessionId;
  return parseStoredResumeState(store.getSessionResumeState(resumeSessionId));
}

export function resolveContinuationInstructionBlock(ctx: PersistenceContext, userText: string): string | null {
  const messages = loadAuthoritativeMessages(ctx);
  const resumeState = resolveContinuationResumeState(ctx);
  return resolveContinuationInstruction({ userText, messages, resumeState });
}

export function persistOutstandingTask(ctx: PersistenceContext, userText: string, failureNote: string): void {
  const store = ctx.getPersistStore();
  if (!store?.setSessionResumeState || !userText.trim()) return;
  const targetSessionId = ctx.options.channelSession
    ? resolveChannelResumeStateSessionId(ctx.sessionId, ctx.linkedContextSessionId)
    : ctx.sessionId;
  store.setSessionResumeState(targetSessionId, {
    kind: 'outstanding_task',
    messageId: generateMessageId(),
    payload: {
      userText: userText.trim(),
      lastFailure: failureNote.slice(0, 280),
    },
    createdAt: new Date().toISOString(),
  });
}

export function clearOutstandingTask(ctx: PersistenceContext): void {
  const store = ctx.getPersistStore();
  const targetSessionId = ctx.options.channelSession
    ? resolveChannelResumeStateSessionId(ctx.sessionId, ctx.linkedContextSessionId)
    : ctx.sessionId;
  const row = store?.getSessionResumeState?.(targetSessionId);
  if (row?.['kind'] === 'outstanding_task') {
    store?.clearSessionResumeState?.(targetSessionId);
  }
}

export function noteTurnOutcome(ctx: PersistenceContext, content: string): void {
  if (!content?.trim()) return;
  const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user');
  let userText = typeof lastUser?.content === 'string'
    ? lastUser.content.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim()
    : '';
  if (ctx.options.channelSession && isContinuationTrigger(userText)) {
    const resumeState = resolveContinuationResumeState(ctx);
    const incomplete = detectIncompleteLastTurn(loadAuthoritativeMessages(ctx));
    userText = resumeState?.userText?.trim()
      || incomplete?.userGoal
      || userText;
  }
  if (isFailureAssistantContent(content)) {
    persistOutstandingTask(ctx, userText, content);
    return;
  }
  if (content.length > 40 && !content.startsWith('⏹')) {
    clearOutstandingTask(ctx);
  }
}

// ─── Message persistence ───

export function buildQuestionnaireMessage(
  ctx: PersistenceContext,
  messageId: string,
  record: QuestionnaireRecord,
): Message {
  const host = ctx.options.crewPrivateHost;
  const crew = ctx.options.promptProfile === 'crew_private' && host
    ? {
      crewId: host.id,
      name: host.name,
      callsign: host.callsign,
      color: host.color,
      icon: host.icon,
    }
    : undefined;
  return {
    id: messageId,
    sessionId: ctx.sessionId,
    role: 'assistant',
    content: '',
    toolCalls: null,
    createdAt: new Date().toISOString(),
    tokenCount: 0,
    crew,
    parts: [{ type: 'questionnaire', id: record.payload.id, questionnaire: record }],
  };
}

export function persistQuestionnaireMessage(ctx: PersistenceContext, msg: Message): void {
  const store = ctx.getPersistStore();
  if (!store?.insertMessage) return;
  try {
    store.insertMessage({
      id: msg.id,
      sessionId: msg.sessionId,
      role: msg.role,
      content: msg.content,
      parts: msg.parts,
      tokenCount: msg.tokenCount ?? 0,
      metadata: msg.crew
        ? { crewId: msg.crew.crewId, crewName: msg.crew.name, callsign: msg.crew.callsign }
        : undefined,
    });
  } catch { /* best-effort */ }
}

export function updateQuestionnaireMessage(
  ctx: PersistenceContext,
  messageId: string,
  record: QuestionnaireRecord,
): void {
  const store = ctx.getPersistStore();
  const parts = [{ type: 'questionnaire', id: record.payload.id, questionnaire: record }];
  store?.updateMessage?.(ctx.sessionId, messageId, { parts });
}

export function persistAssistantMessage(ctx: PersistenceContext, msg: Message): void {
  const store = ctx.getPersistStore();
  if (!store?.insertMessage) return;
  try {
    const channel = ctx.activeInboundChannel ?? parseChannelBindingFromSessionId(ctx.sessionId) ?? undefined;
    const metadata: Record<string, unknown> = {
      ...(msg.crew
        ? {
          crewId: msg.crew.crewId,
          crewName: msg.crew.name,
          callsign: msg.crew.callsign,
        }
        : {}),
    };
    if (channel) metadata['channel'] = channel;
    store.insertMessage({
      id: msg.id,
      sessionId: ctx.sessionId,
      role: 'assistant',
      content: msg.content,
      tokenCount: msg.tokenCount ?? 0,
      metadata,
    });
  } catch { /* best-effort */ }
}

export function persistUserMessage(ctx: PersistenceContext, msg: Message): void {
  const store = ctx.getPersistStore();
  if (!store?.insertMessage) return;
  const channel = ctx.activeInboundChannel ?? parseChannelBindingFromSessionId(ctx.sessionId) ?? undefined;
  try {
    const msgMeta = (msg.metadata ?? {}) as Record<string, unknown>;
    const metadata: Record<string, unknown> = { ...msgMeta };
    if (channel && !metadata['channel']) metadata['channel'] = channel;
    // Extract platform columns from message metadata (set by Agent.sendMessage).
    const platformMessageId = msgMeta['platformMessageId'] as number | undefined;
    const platformChatId = msgMeta['platformChatId'] as number | undefined;
    store.insertMessage({
      id: msg.id,
      sessionId: msg.sessionId,
      role: 'user',
      content: msg.content,
      tokenCount: msg.tokenCount ?? 0,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(platformMessageId != null ? { platformMessageId } : {}),
      ...(platformChatId != null ? { platformChatId } : {}),
    });
  } catch { /* best-effort */ }
}

// ─── Permission persistence ───

export function persistPermissionGrant(
  ctx: PersistenceContext,
  toolName: string,
  decision: PermissionDecision,
): void {
  const store = ctx.getPersistStore();
  if (!store?.addPermission) return;
  try {
    store.addPermission(ctx.sessionId, { toolName, targetPath: null, decision });
  } catch { /* best-effort */ }
}

export function restoreSessionPermissions(ctx: PersistenceContext): void {
  if (!ctx.sessionManager || !ctx.toolExecutor) return;
  const store = ctx.getPersistStore();
  if (!store?.getPermissions) return;
  try {
    const rows = store.getPermissions(ctx.sessionId);
    const pm = ctx.toolExecutor.getPermissionManager();
    const seen = new Set<string>();
    for (const row of rows) {
      const decision = row.decision as PermissionDecision;
      if (!row.toolName || seen.has(row.toolName)) continue;
      seen.add(row.toolName);
      if (row.toolName === '*') {
        pm.allowAll();
      } else if (decision === 'allow_always') {
        pm.grant(row.toolName, 'allow_always');
      } else if (decision === 'deny') {
        pm.deny(row.toolName);
      }
    }
  } catch { /* best-effort */ }
}

export function formatChannelToolPermissions(ctx: PersistenceContext): string {
  const pm = ctx.toolExecutor?.getPermissionManager();
  if (!pm) return '🔐 No permission state available.';
  if (pm.isAllAllowed()) {
    return '🔐 *Permissions*\n✅ All tools are always allowed for this channel session.';
  }
  const perms = pm.list().filter((p) => p.id !== '__all__');
  const allowed = perms.filter((p) => p.decision === 'allow_always').map((p) => p.toolName);
  const denied = perms.filter((p) => p.decision === 'deny').map((p) => p.toolName);
  const lines = ['🔐 *Permissions*'];
  lines.push('', '*Always allowed:*', allowed.length ? allowed.map((t) => `  ✅ ${t}`).join('\n') : '  (none)');
  lines.push('', '*Denied:*', denied.length ? denied.map((t) => `  ❌ ${t}`).join('\n') : '  (none)');
  lines.push('', 'Revoke with `/permissions revoke <tool>` or `/permissions revoke-all`.');
  return lines.join('\n');
}

export function revokeChannelToolPermissions(
  ctx: PersistenceContext,
  tools?: string[],
  revokeAll = false,
): string {
  const pm = ctx.toolExecutor?.getPermissionManager();
  if (!pm) return '🔐 No permission state available.';
  const store = ctx.getPersistStore();

  if (revokeAll) {
    pm.revokeAll();
    store?.removePermissions?.(ctx.sessionId);
    return '🗑 All remembered tool permissions revoked for this channel session.';
  }

  const names = (tools ?? []).map((t) => t.trim()).filter(Boolean);
  if (!names.length) return '❌ Specify at least one tool name to revoke.';
  for (const name of names) {
    pm.revoke(name);
    store?.removePermissions?.(ctx.sessionId, name);
  }
  return `🗑 Revoked permissions for: ${names.join(', ')}`;
}
