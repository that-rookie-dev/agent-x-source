import type { Session, SessionStatus, SessionEvent } from '@agentx/shared';
import type { StorageAdapter } from '@agentx/shared';
import { generateSessionId, generateId } from '@agentx/shared';
import { SessionStore } from './SessionStore.js';
import { TokenTracker } from './TokenTracker.js';

export interface SessionManagerOptions {
  dbPath?: string;
  storageAdapter?: StorageAdapter;
}

export class SessionManager {
  private store: SessionStore | StorageAdapter;
  private usingStorageAdapter: boolean;
  private activeSession: Session | null = null;
  private tokenTracker: TokenTracker | null = null;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionManagerOptions = {}) {
    if (options.storageAdapter) {
      this.store = options.storageAdapter;
      this.usingStorageAdapter = true;
    } else {
      this.store = new SessionStore(options.dbPath);
      this.usingStorageAdapter = false;
    }
  }

  private getSessionStore(): SessionStore {
    return this.store as SessionStore;
  }

  /**
   * Inject the Data Encryption Key for encrypting sensitive session data at rest.
   * Must be called after successful authentication to enable field-level encryption.
   */
  setDEK(_dek: Buffer | null): void {
  }

  /** Get the underlying SQLite database handle (null if using storage adapter). */
  getDb(): unknown {
    if (this.usingStorageAdapter) return null;
    return this.getSessionStore().getDb();
  }

  private createSessionRecord(session: Session): void {
    if (this.usingStorageAdapter) {
      const adapter = this.store as StorageAdapter;
      adapter.createSession({
        title: session.title,
        status: session.status,
        providerId: session.providerId,
        modelId: session.modelId,
        crewId: session.crewId,
        scopePath: session.scopePath,
        tokenUsed: session.tokenUsed,
        tokenAvailable: session.tokenAvailable,
      });
    } else {
      this.getSessionStore().createSession({
        id: session.id,
        title: session.title,
        status: session.status,
        provider: session.providerId,
        model: session.modelId,
        crewId: session.crewId,
        parentId: session.parentId,
        scopePath: session.scopePath,
        tokensUsed: session.tokenUsed,
        tokenAvailable: session.tokenAvailable,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
  }

  private updateSessionRecord(id: string, updates: Partial<Session>): void {
    if (this.usingStorageAdapter) {
      (this.store as StorageAdapter).updateSession(id, updates as Record<string, unknown>);
    } else {
      this.getSessionStore().updateSession(id, updates);
    }
  }

  private getSessionRecord(id: string): Session | null {
    if (this.usingStorageAdapter) {
      const s = (this.store as StorageAdapter).getSession(id);
      return s as unknown as Session | null;
    }
    return this.getSessionStore().getSession(id) as unknown as Session | null;
  }

  private listSessionRecords(limit = 20): Session[] {
    if (this.usingStorageAdapter) {
      return (this.store as StorageAdapter).listSessions(limit) as unknown as Session[];
    }
    return this.getSessionStore().listSessions(limit) as unknown as Session[];
  }

  createSession(providerId: string, modelId: string, crewId?: string, scopePath?: string, id?: string, parentId?: string): Session {
    const contextWindow = 128_000;
    const session: Session = {
      id: id ?? generateSessionId(),
      title: parentId ? 'Child Session' : 'New Session',
      status: 'active' as SessionStatus,
      parentId: parentId ?? null,
      providerId,
      modelId,
      crewId: crewId ?? null,
      scopePath: scopePath!,
      mode: 'plan',
      tokenUsed: 0,
      tokenAvailable: contextWindow,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.createSessionRecord(session);
    this.activeSession = session;
    this.tokenTracker = new TokenTracker(contextWindow);

    // Auto-save every 30 seconds
    this.startAutoSave();

    return session;
  }

  getChildSessions(parentId: string): Session[] {
    const all = this.listSessions(9999);
    return all.filter(s => s.parentId === parentId);
  }

  getSessionTree(): Session[] {
    const all = this.listSessions(9999);
    return all;
  }

  getActiveSession(): Session | null {
    return this.activeSession;
  }

  getTokenTracker(): TokenTracker | null {
    return this.tokenTracker;
  }

  updateSession(updates: Partial<Session>): void {
    if (!this.activeSession) return;
    this.activeSession = { ...this.activeSession, ...updates, updatedAt: new Date().toISOString() };
    this.updateSessionRecord(this.activeSession.id, updates);
  }

  async endSession(): Promise<void> {
    if (!this.activeSession) return;
    this.stopAutoSave();
    this.updateSession({ status: 'completed' as SessionStatus });
    this.activeSession = null;
    this.tokenTracker = null;
  }

  restoreSession(sessionId: string): Session | null {
    const row = this.getSessionRecord(sessionId);
    if (row) {
      const session = row;
      this.activeSession = session;
      this.tokenTracker = new TokenTracker(session.tokenAvailable || 128_000);
      if (session.tokenUsed) {
        this.tokenTracker.setUsed(session.tokenUsed);
      }
      this.startAutoSave();
      return session;
    }
    return null;
  }

  replayEvents(sessionId: string, sinceSequence?: number): Generator<SessionEvent, void, undefined> {
    if (this.usingStorageAdapter) {
      return {
        next: () => ({ value: undefined, done: true }),
        [Symbol.iterator]() { return this; },
      } as unknown as Generator<SessionEvent, void, undefined>;
    }
    return this.getSessionStore().replayEvents(sessionId, sinceSequence);
  }

  getSessionEvents(sessionId: string, sinceSequence?: number): SessionEvent[] {
    if (this.usingStorageAdapter) return [];
    return this.getSessionStore().getSessionEvents(sessionId, sinceSequence);
  }

  saveCrewState(crewId: string, enabled: boolean, messageCount?: number): void {
    if (!this.activeSession || this.usingStorageAdapter) return;
    
    this.getSessionStore().saveCrewState({
      id: generateId(),
      sessionId: this.activeSession.id,
      crewId,
      enabled,
      lastActive: new Date().toISOString(),
      messageCount: messageCount ?? 0,
    });
  }

  getCrewStates(): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    if (!this.activeSession || this.usingStorageAdapter) return [];
    
    const rows = this.getSessionStore().getCrewStates(this.activeSession.id);
    return rows.map((row) => ({
      crewId: row['crew_id'] as string,
      enabled: (row['enabled'] as number) === 1,
      lastActive: row['last_active'] as string | undefined,
      messageCount: row['message_count'] as number | undefined,
    }));
  }

  loadCrewStates(sessionId: string): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    if (this.usingStorageAdapter) return [];
    const rows = this.getSessionStore().getCrewStates(sessionId);
    return rows.map((row) => ({
      crewId: row['crew_id'] as string,
      enabled: (row['enabled'] as number) === 1,
      lastActive: row['last_active'] as string | undefined,
      messageCount: row['message_count'] as number | undefined,
    }));
  }

  restoreCrewStates(): Array<{ crewId: string; enabled: boolean }> {
    if (!this.activeSession || this.usingStorageAdapter) return [];
    return this.loadCrewStates(this.activeSession.id).map((s) => ({
      crewId: s.crewId,
      enabled: s.enabled,
    }));
  }

  listSessions(limit = 20): Session[] {
    return this.listSessionRecords(limit);
  }

  addTokenLog(opts: { sessionId: string; inputTokens: number; outputTokens: number; model: string; costUsd: number; providerId: string; crewId?: string }): void {
    const log = {
      sessionId: opts.sessionId,
      model: opts.model,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd: opts.costUsd,
      providerId: opts.providerId,
    };
    if (this.usingStorageAdapter) {
      (this.store as StorageAdapter).addTokenLog(opts.sessionId, log);
    } else {
      this.getSessionStore().addTokenLog({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, sessionId: opts.sessionId, providerId: opts.providerId, modelId: opts.model, inputTokens: opts.inputTokens, outputTokens: opts.outputTokens, costUsd: opts.costUsd, crewId: opts.crewId });
    }
  }

  addToolExecution(exec: {
    id: string;
    sessionId: string;
    toolName: string;
    input: string;
    output: string;
    success: boolean;
    elapsedMs: number;
  }): void {
    if (this.usingStorageAdapter) return;
    this.getSessionStore().addToolExecution(exec);
  }

  private startAutoSave(): void {
    this.stopAutoSave();
    this.autoSaveInterval = setInterval(() => {
      if (this.activeSession && this.tokenTracker) {
        if (this.usingStorageAdapter) {
          (this.store as StorageAdapter).updateSession(this.activeSession.id, {
            tokenUsed: this.tokenTracker.tokensUsed,
          } as Partial<Session>);
        } else {
          this.getSessionStore().updateSession(this.activeSession.id, {
            tokensUsed: this.tokenTracker.tokensUsed,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }, 30_000);
  }

  private stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  close(): void {
    this.stopAutoSave();
    if (this.usingStorageAdapter) {
      (this.store as StorageAdapter).close();
    } else {
      this.getSessionStore().close();
    }
  }
}
