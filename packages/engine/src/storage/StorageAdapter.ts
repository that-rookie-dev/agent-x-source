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
    return rows.map((row) => ({
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
      createdAt: row['createdAt'] as string,
      updatedAt: row['updatedAt'] as string,
    }));
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
      createdAt: row['created_at'] as string,
    }));
  }

  deleteMessages(sessionId: string): void {
    this.store.deleteMessages(sessionId);
  }

  getMessageCount(sessionId: string): number {
    return this.store.getMessageCount(sessionId);
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
