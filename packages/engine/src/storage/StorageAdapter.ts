import { generateId } from '@agentx/shared';
import type {
  StorageAdapter,
  StorableSession,
  StorableMessage,
  StorableTokenLog,
  StorablePermission,
  RecordMeta,
} from '@agentx/shared';
import { SessionStore } from '../session/SessionStore.js';

export class DefaultStorageAdapter implements StorageAdapter {
  private store: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store ?? new SessionStore();
  }

  connect(): void {
  }

  disconnect(): void {
    this.store.close();
  }

  isConnected(): boolean {
    return true;
  }

  createSession(input: Omit<StorableSession, keyof RecordMeta>): StorableSession {
    const id = generateId();
    const now = new Date().toISOString();
    const inputAny = input as Record<string, unknown>;
    const session: StorableSession = {
      id, ...input,
      mode: (inputAny['mode'] as string) ?? 'plan',
      parentId: (inputAny['parentId'] as string) ?? null,
      contextKind: (inputAny['contextKind'] as StorableSession['contextKind']) ?? 'agent_x',
      hostCrewId: (inputAny['hostCrewId'] as string | null) ?? null,
      hyperdrive: !!(inputAny['hyperdrive']),
      createdAt: now, updatedAt: now,
    };
    this.store.createSession({
      id: session.id,
      title: session.title,
      status: session.status,
      provider: session.providerId,
      model: session.modelId,
      parentId: session.parentId,
      scopePath: session.scopePath,
      tokensUsed: session.tokenUsed,
      tokenAvailable: session.tokenAvailable,
      mode: session.mode,
      hyperdrive: session.hyperdrive,
      contextKind: session.contextKind ?? 'agent_x',
      hostCrewId: session.hostCrewId ?? null,
      hostCrewName: session.hostCrewName ?? null,
      hostCrewCallsign: session.hostCrewCallsign ?? null,
      hostCrewTitle: session.hostCrewTitle ?? null,
      hostCrewColor: session.hostCrewColor ?? null,
      hostCrewCatalogId: session.hostCrewCatalogId ?? null,
      hostCrewCategoryId: session.hostCrewCategoryId ?? null,
      createdAt: session.createdAt!,
      updatedAt: session.updatedAt!,
    });
    return session;
  }

  getSession(id: string): StorableSession | null {
    const row = this.store.getSession(id);
    if (!row) return null;
    return {
      id: row['id'] as string,
      title: row['title'] as string,
      status: row['status'] as string,
      providerId: row['provider'] as string,
      modelId: row['model'] as string,
      scopePath: row['scopePath'] as string,
      mode: row['mode'] as string | undefined,
      parentId: row['parentId'] as string | null | undefined,
      hyperdrive: row['hyperdrive'] as boolean | undefined,
      tokenUsed: (row['tokensUsed'] as number) ?? 0,
      tokenAvailable: (row['tokenAvailable'] as number) ?? 128_000,
      compactionCount: (row['compactionCount'] as number) ?? 0,
      contextKind: (row['contextKind'] as StorableSession['contextKind']) ?? 'agent_x',
      hostCrewId: (row['hostCrewId'] as string | null) ?? null,
      hostCrewName: (row['hostCrewName'] as string | null) ?? null,
      hostCrewCallsign: (row['hostCrewCallsign'] as string | null) ?? null,
      hostCrewTitle: (row['hostCrewTitle'] as string | null) ?? null,
      hostCrewColor: (row['hostCrewColor'] as string | null) ?? null,
      hostCrewCatalogId: (row['hostCrewCatalogId'] as string | null) ?? null,
      hostCrewCategoryId: (row['hostCrewCategoryId'] as string | null) ?? null,
      createdAt: row['createdAt'] as string,
      updatedAt: row['updatedAt'] as string,
    };
  }

  updateSession(id: string, updates: Partial<StorableSession>): void {
    this.store.updateSession(id, (updates as unknown) as Record<string, unknown>);
  }

  deleteSession(id: string): void {
    this.store.deleteSession(id);
  }

  listSessions(limit?: number): StorableSession[] {
    const rows = this.store.listSessions(limit);
    return rows.map((row) => this.mapSessionRow(row));
  }

  listRootSessions(limit?: number): StorableSession[] {
    const listFn = (this.store as { listRootSessions?: (n?: number) => Array<Record<string, unknown>> }).listRootSessions;
    const rows = listFn ? listFn.call(this.store, limit) : this.store.listSessions(limit).filter((r) => !r['parentId']);
    return rows.map((row) => this.mapSessionRow(row));
  }

  listChildSessions(parentSessionId: string): StorableSession[] {
    const listFn = (this.store as { listChildSessions?: (id: string) => Array<Record<string, unknown>> }).listChildSessions;
    const rows = listFn ? listFn.call(this.store, parentSessionId) : this.store.listSessions(9999).filter((r) => r['parentId'] === parentSessionId);
    return rows.map((row) => this.mapSessionRow(row));
  }

  registerChildSession(entry: {
    id: string;
    parentSessionId: string;
    kind: string;
    label?: string;
    status?: string;
  }): void {
    const registerFn = (this.store as { registerChildSession?: (e: typeof entry) => void }).registerChildSession;
    if (registerFn) registerFn.call(this.store, entry);
  }

  getSessionListKpis(sessionId: string, base?: Record<string, unknown>): Record<string, unknown> {
    const kpisFn = (this.store as { getSessionListKpis?: (id: string, b?: Record<string, unknown>) => Record<string, unknown> }).getSessionListKpis;
    if (kpisFn) return kpisFn.call(this.store, sessionId, base);
    return {
      messageCount: this.getMessageCount(sessionId),
      childSessionCount: this.listChildSessions(sessionId).length,
      crewCount: 0,
      crewCallsigns: [],
      totalCostUsd: 0,
      compactionCount: Number(base?.['compactionCount'] ?? 0),
      tokensUsed: Number(base?.['tokensUsed'] ?? base?.['tokenUsed'] ?? 0),
      tokenAvailable: Number(base?.['tokenAvailable'] ?? 128_000),
      tokenUsagePct: 0,
    };
  }

  private mapSessionRow(row: Record<string, unknown>): StorableSession {
    return {
      id: row['id'] as string,
      title: row['title'] as string,
      status: row['status'] as string,
      providerId: row['provider'] as string,
      modelId: row['model'] as string,
      scopePath: row['scopePath'] as string,
      mode: row['mode'] as string | undefined,
      parentId: row['parentId'] as string | null | undefined,
      hyperdrive: row['hyperdrive'] as boolean | undefined,
      tokenUsed: (row['tokensUsed'] as number) ?? 0,
      tokenAvailable: (row['tokenAvailable'] as number) ?? 128_000,
      compactionCount: (row['compactionCount'] as number) ?? 0,
      contextKind: (row['contextKind'] as StorableSession['contextKind']) ?? 'agent_x',
      hostCrewId: (row['hostCrewId'] as string | null) ?? null,
      hostCrewName: (row['hostCrewName'] as string | null) ?? null,
      hostCrewCallsign: (row['hostCrewCallsign'] as string | null) ?? null,
      hostCrewTitle: (row['hostCrewTitle'] as string | null) ?? null,
      hostCrewColor: (row['hostCrewColor'] as string | null) ?? null,
      hostCrewCatalogId: (row['hostCrewCatalogId'] as string | null) ?? null,
      hostCrewCategoryId: (row['hostCrewCategoryId'] as string | null) ?? null,
      createdAt: row['createdAt'] as string,
      updatedAt: row['updatedAt'] as string,
    };
  }

  addMessage(_sessionId: string, message: Omit<StorableMessage, 'id' | 'createdAt'>): StorableMessage {
    const id = generateId();
    const now = new Date().toISOString();
    const msg: StorableMessage = { id, ...message, createdAt: now };
    this.store.addMessage({
      id,
      sessionId: msg.sessionId,
      role: msg.role,
      content: msg.content,
      tokenCount: msg.tokenCount,
      toolCalls: msg.toolCalls,
      createdAt: now,
    });
    return msg;
  }

  getMessages(sessionId: string): StorableMessage[] {
    const rows = this.store.getMessages(sessionId);
    return rows.map((row) => ({
      id: row['id'] as string,
      sessionId: row['session_id'] as string,
      role: row['role'] as string,
      content: row['content'] as string,
      tokenCount: (row['token_count'] as number) ?? 0,
      toolCalls: row['tool_calls'] as string | undefined,
      parts: row['parts'] as StorableMessage['parts'],
      metadata: row['metadata'] as StorableMessage['metadata'],
      createdAt: row['created_at'] as string,
    }));
  }

  deleteMessages(sessionId: string): void {
    this.store.deleteMessages(sessionId);
  }

  getMessageCount(sessionId: string): number {
    return this.store.getMessageCount(sessionId);
  }

  getMessagesPage(
    sessionId: string,
    opts: { limit?: number; before?: string },
  ): { messages: Array<Record<string, unknown>>; total: number; hasMore: boolean } {
    const fn = (this.store as {
      getMessagesPage?: (id: string, opts: { limit?: number; before?: string }) => {
        messages: Array<Record<string, unknown>>;
        total: number;
        hasMore: boolean;
      };
    }).getMessagesPage;
    if (fn) return fn.call(this.store, sessionId, opts);
    const all = this.getMessages(sessionId).filter((m) => m.role === 'user' || m.role === 'assistant');
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    let slice = all;
    if (opts.before) {
      const idx = all.findIndex((m) => m.id === opts.before);
      slice = idx > 0 ? all.slice(0, idx) : [];
    }
    const page = slice.slice(-limit);
    return { messages: page as unknown as Array<Record<string, unknown>>, total: all.length, hasMore: slice.length > page.length };
  }

  saveTaskSnapshot(snapshot: {
    sessionId: string;
    taskId: string;
    stepIndex: number;
    goal: string;
    planState: string;
    failureHistory: string;
  }): void {
    const fn = (this.store as { saveTaskSnapshot?: (s: typeof snapshot) => void }).saveTaskSnapshot;
    if (fn) fn.call(this.store, snapshot);
  }

  getTaskSnapshot(sessionId: string): Record<string, unknown> | null {
    const fn = (this.store as { getTaskSnapshot?: (id: string) => Record<string, unknown> | null }).getTaskSnapshot;
    return fn ? fn.call(this.store, sessionId) : null;
  }

  deleteTaskSnapshot(sessionId: string): void {
    const fn = (this.store as { deleteTaskSnapshot?: (id: string) => void }).deleteTaskSnapshot;
    if (fn) fn.call(this.store, sessionId);
  }

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void {
    this.store.addTokenLog({
      id: generateId(),
      sessionId,
      providerId: 'unknown',
      modelId: log.model,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
    });
  }

  getTokenLogs(sessionId: string): StorableTokenLog[] {
    const rows = this.store.getTokenLogs(sessionId);
    return rows.map((row) => ({
      id: row['id'] as string,
      sessionId: row['session_id'] as string,
      inputTokens: row['input_tokens'] as number,
      outputTokens: row['output_tokens'] as number,
      model: row['model_id'] as string,
      createdAt: row['created_at'] as string,
    }));
  }

  addPermission(sessionId: string, perm: Omit<StorablePermission, 'id' | 'createdAt'>): void {
    this.store.addPermission({
      id: generateId(),
      sessionId,
      toolName: perm.toolName,
      targetPath: perm.targetPath ?? undefined,
      decision: perm.decision,
    });
  }

  getPermissions(sessionId: string): StorablePermission[] {
    const rows = this.store.getPermissions(sessionId);
    return rows.map((row) => ({
      id: row['id'] as string,
      sessionId: row['session_id'] as string,
      toolName: row['tool_name'] as string,
      targetPath: (row['target_path'] as string) ?? null,
      decision: row['decision'] as string,
      createdAt: row['created_at'] as string,
    }));
  }

  clearAll(): void {
    this.store.clearAll();
  }

  close(): void {
    this.store.close();
  }
}
