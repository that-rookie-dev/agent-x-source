import type {
  Message,
  EngineEvent,
  CompletionMessage,
  QuestionnaireRecord,
  PermissionDecision,
  SessionResumeState,
  SessionContextKind,
  AgentXConfig,
  StorageAdapter,
} from '@agentx/shared';
import {
  generateMessageId,
  resolveContinuationInstruction,
  detectIncompleteLastTurn,
  isContinuationTrigger,
  mergeChannelLinkedMessages,
  resolveChannelResumeStateSessionId,
  parseChannelBindingFromSessionId,
} from '@agentx/shared';
import { globalNarrativeStore } from '../../context/SessionNarrativeStore.js';
import { renderNarrativeText } from '../../context/NarrativeBuilder.js';
import type { ToolExecutor } from '../../tools/ToolExecutor.js';
import type { PermissionManager } from '../../tools/permissions/PermissionManager.js';

/** Minimal interface for the SessionManager methods used by SessionOrchestrator. */
interface SessionManagerLike {
  getStorageAdapter(): StorageAdapter;
  saveCrewState?(crewId: string, enabled: boolean, messageCount?: number): void;
  createChildSessionRecord?(
    childId: string,
    parentId: string,
    providerId: string,
    modelId: string,
    scopePath?: string,
    meta?: { kind?: string; label?: string },
  ): unknown;
  persistSessionFields?(sessionId: string, fields: Record<string, unknown>): void;
  syncActiveSessionRuntime?(updates: { providerId?: string; modelId?: string; mode?: 'agent' | 'plan' }): void;
  getSessionById?(id: string): { title?: string } | null;
}

export interface SessionOrchestratorHost {
  readonly sessionId: string;
  readonly options: { channelSession?: boolean; contextKind?: SessionContextKind };
  readonly messages: CompletionMessage[];
  getToolExecutor(): ToolExecutor | undefined;
  getPermissionManager(): PermissionManager | undefined;
  getActiveInboundChannel(): string | null;
  getConfig(): AgentXConfig;
  getScopePath(): string;
  emit(event: EngineEvent): void;
}

export class SessionOrchestrator {
  private sessionManager: SessionManagerLike | null = null;
  private linkedContextSessionId: string | null = null;

  constructor(private readonly host: SessionOrchestratorHost) {}

  setSessionManager(sm: SessionManagerLike): void {
    this.sessionManager = sm;
    this.restoreSessionPermissions();
  }

  getSessionManager(): SessionManagerLike | null {
    return this.sessionManager;
  }

  getSessionId(): string {
    return this.host.sessionId;
  }

  getStore(): StorageAdapter | null {
    return this.sessionManager?.getStorageAdapter() ?? null;
  }

  setLinkedContextSessionId(sessionId: string | null): void {
    this.linkedContextSessionId = sessionId?.trim() || null;
  }

  getLinkedContextSessionId(): string | null {
    return this.linkedContextSessionId;
  }

  saveCrewState(crewId: string, enabled: boolean, messageCount?: number): void {
    this.sessionManager?.saveCrewState?.(crewId, enabled, messageCount);
  }

  createChildSession(
    childId: string,
    meta?: { kind?: 'sub_agent' | 'crew_worker'; label?: string },
  ): void {
    if (!this.sessionManager?.createChildSessionRecord) return;
    this.sessionManager.createChildSessionRecord(
      childId,
      this.host.sessionId,
      this.host.getConfig().provider.activeProvider,
      this.host.getConfig().provider.activeModel,
      this.host.getScopePath(),
      meta,
    );
    this.host.emit({
      type: 'child_session_started',
      childSessionId: childId,
      parentSessionId: this.host.sessionId,
      label: meta?.label ?? 'Background work',
      kind: meta?.kind ?? 'sub_agent',
    });
  }

  persistSessionFields(fields: Record<string, unknown>): void {
    try {
      this.sessionManager?.persistSessionFields?.(this.host.sessionId, fields);
    } catch { /* best-effort */ }
  }

  syncSessionRuntimeRecord(patch: {
    providerId?: string;
    modelId?: string;
    mode?: 'agent' | 'plan';
  }): void {
    try {
      this.sessionManager?.syncActiveSessionRuntime?.(patch);
    } catch { /* best-effort */ }
  }

  persistPermissionGrant(toolName: string, decision: PermissionDecision): void {
    if (!this.sessionManager) return;
    const store = this.getStore();
    if (!store) return;
    try {
      store.addPermission(this.host.sessionId, {
        toolName,
        targetPath: null,
        decision,
      });
    } catch { /* best-effort */ }
  }

  restoreSessionPermissions(): void {
    if (!this.sessionManager || !this.host.getToolExecutor()) return;
    const store = this.getStore();
    if (!store) return;
    try {
      const rows = store.getPermissions(this.host.sessionId);
      const pm = this.host.getToolExecutor()!.getPermissionManager();
      const seen = new Set<string>();
      for (const row of rows) {
        const toolName = row.toolName;
        const decision = row.decision as PermissionDecision;
        if (!toolName || seen.has(toolName)) continue;
        seen.add(toolName);
        if (toolName === '*') {
          pm.allowAll();
        } else if (decision === 'allow_always') {
          pm.grant(toolName, 'allow_always');
        } else if (decision === 'deny') {
          pm.deny(toolName);
        }
      }
    } catch { /* best-effort */ }
  }

  removeStorePermissions(toolName?: string): void {
    const store = this.getStore();
    if (!store?.removePermissions) return;
    try {
      store.removePermissions(this.host.sessionId, toolName);
    } catch { /* best-effort */ }
  }

  getLinkedContextBlock(): string | null {
    if (!this.host.options.channelSession || !this.linkedContextSessionId) return null;
    const linked = this.sessionManager?.getSessionById?.(this.linkedContextSessionId);
    const title = linked?.title?.trim() || this.linkedContextSessionId;
    const narrative = globalNarrativeStore.load(this.linkedContextSessionId);
    const narrativeText = narrative ? renderNarrativeText(narrative) : '';
    return [
      '[LINKED_DESKTOP_SESSION]',
      `Telegram is context-linked to desktop session "${title}" (${this.linkedContextSessionId}).`,
      'Telegram chat history is separate from the desktop transcript — use linked narrative and resume state for goals.',
      ...(narrativeText ? ['', 'Linked session narrative:', narrativeText] : []),
      '[/LINKED_DESKTOP_SESSION]',
    ].join('\n');
  }

  resolveContinuationInstructionBlock(userText: string): string | null {
    const messages = this.loadAuthoritativeMessages();
    const resumeState = this.resolveContinuationResumeState();
    return resolveContinuationInstruction({ userText, messages, resumeState });
  }

  noteTurnOutcome(content: string): void {
    if (!content?.trim()) return;
    const lastUser = [...this.host.messages].reverse().find((m) => m.role === 'user');
    let userText = typeof lastUser?.content === 'string'
      ? lastUser.content.replace(/\n\[TURN[^\]]*\][^\n]*/g, '').trim()
      : '';
    if (this.host.options.channelSession && isContinuationTrigger(userText)) {
      const resumeState = this.resolveContinuationResumeState();
      const incomplete = detectIncompleteLastTurn(this.loadAuthoritativeMessages());
      userText = resumeState?.userText?.trim()
        || incomplete?.userGoal
        || userText;
    }
    if (this.isFailureAssistantContent(content)) {
      this.persistOutstandingTask(userText, content);
      return;
    }
    if (content.length > 40 && !content.startsWith('⏹')) {
      this.clearOutstandingTask();
    }
  }

  persistClarificationMessage(msg: Message): void {
    const store = this.getMessageStore();
    if (store?.insertMessage) {
      try {
        store.insertMessage({
          id: msg.id,
          sessionId: msg.sessionId,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        });
      } catch { /* best-effort */ }
    }
  }

  persistQuestionnaireMessage(msg: Message): void {
    const store = this.getMessageStore();
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

  updateQuestionnaireMessage(messageId: string, record: QuestionnaireRecord): void {
    const store = this.getMessageStore();
    const parts = [{ type: 'questionnaire', id: record.payload.id, questionnaire: record }];
    store?.updateMessage?.(this.host.sessionId, messageId, { parts });
  }

  persistUserMessage(msg: Message): void {
    const store = this.getMessageStore();
    if (!store?.insertMessage) return;
    const channel = this.host.getActiveInboundChannel() ?? parseChannelBindingFromSessionId(this.host.sessionId) ?? undefined;
    try {
      store.insertMessage({
        id: msg.id,
        sessionId: msg.sessionId,
        role: 'user',
        content: msg.content,
        tokenCount: msg.tokenCount ?? 0,
        ...(channel ? { metadata: { channel } } : {}),
      });
    } catch { /* best-effort */ }
  }

  persistAssistantMessage(msg: Message): void {
    const store = this.getMessageStore();
    if (!store?.insertMessage) return;
    try {
      const channel = this.host.getActiveInboundChannel() ?? parseChannelBindingFromSessionId(this.host.sessionId) ?? undefined;
      store.insertMessage({
        id: msg.id,
        sessionId: this.host.sessionId,
        role: 'assistant',
        content: msg.content,
        tokenCount: msg.tokenCount ?? 0,
        metadata: {
          ...(msg.crew
            ? {
              crewId: msg.crew.crewId,
              crewName: msg.crew.name,
              callsign: msg.crew.callsign,
            }
            : {}),
          ...(channel ? { channel } : {}),
        },
      });
    } catch { /* best-effort */ }
  }

  private getPersistStore(): StorageAdapter | null {
    return this.getStore();
  }

  private getMessageStore(): StorageAdapter | null {
    return this.getStore();
  }

  private parseStoredResumeState(row: Record<string, unknown> | null | undefined): SessionResumeState | null {
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

  private loadAuthoritativeMessages(): Array<{ role?: string; content?: string; parts?: unknown }> {
    const store = this.getPersistStore();
    if (store?.getMessages) {
      if (this.host.options.channelSession && this.linkedContextSessionId) {
        const linked = store.getMessages(this.linkedContextSessionId);
        const channel = store.getMessages(this.host.sessionId);
        return mergeChannelLinkedMessages(linked, channel);
      }
      return store.getMessages(this.host.sessionId);
    }
    return this.host.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    }));
  }

  private resolveContinuationResumeState(): SessionResumeState | null {
    const store = this.getPersistStore();
    if (!store?.getSessionResumeState) return null;
    const resumeSessionId = this.host.options.channelSession
      ? resolveChannelResumeStateSessionId(this.host.sessionId, this.linkedContextSessionId)
      : this.host.sessionId;
    return this.parseStoredResumeState(store.getSessionResumeState(resumeSessionId));
  }

  private persistOutstandingTask(userText: string, failureNote: string): void {
    const store = this.getPersistStore();
    if (!store?.setSessionResumeState || !userText.trim()) return;
    const targetSessionId = this.host.options.channelSession
      ? resolveChannelResumeStateSessionId(this.host.sessionId, this.linkedContextSessionId)
      : this.host.sessionId;
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

  private clearOutstandingTask(): void {
    const store = this.getPersistStore();
    const targetSessionId = this.host.options.channelSession
      ? resolveChannelResumeStateSessionId(this.host.sessionId, this.linkedContextSessionId)
      : this.host.sessionId;
    const row = store?.getSessionResumeState?.(targetSessionId);
    if (row?.['kind'] === 'outstanding_task') {
      store?.clearSessionResumeState?.(targetSessionId);
    }
  }

  private isFailureAssistantContent(content: string): boolean {
    return /\b(unable to generate|i apologize|i was unable|provider error|encountered an error|cannot assist|tell me which|please tell me|which action you)\b/i.test(content);
  }
}
