import type { Session, SessionStatus, SessionEvent } from '@agentx/shared';
import type { StorageAdapter } from '@agentx/shared';
import { generateSessionId, generateId } from '@agentx/shared';
import { SessionStore } from './SessionStore.js';
import { TokenTracker } from './TokenTracker.js';
import { normalizeSessionUpdates, EMPTY_SESSION_KPIS } from './session-field-utils.js';
import type { SessionListKpis } from './session-field-utils.js';

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
      (adapter as any).createSession({
        id: session.id,
        title: session.title,
        status: session.status,
        providerId: session.providerId,
        modelId: session.modelId,
        scopePath: session.scopePath,
        mode: session.mode,
        parentId: session.parentId,
        hyperdrive: session.hyperdrive,
        tokenUsed: session.tokenUsed,
        tokenAvailable: session.tokenAvailable,
        contextKind: session.contextKind ?? 'agent_x',
        hostCrewId: session.hostCrewId ?? null,
      });
    } else {
      this.getSessionStore().createSession({
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
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
  }

  private updateSessionRecord(id: string, updates: Partial<Session>): void {
    const normalized = normalizeSessionUpdates(updates as Record<string, unknown>);
    if (this.usingStorageAdapter) {
      (this.store as StorageAdapter).updateSession(id, normalized as Partial<Session>);
    } else {
      this.getSessionStore().updateSession(id, normalized);
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

  createSession(providerId: string, modelId: string, scopePath?: string, id?: string, parentId?: string): Session {
    const session = this.buildSessionRecord(providerId, modelId, scopePath, id, parentId);
    this.createSessionRecord(session);
    this.activeSession = session;
    this.tokenTracker = new TokenTracker(session.tokenAvailable || 128_000);
    this.startAutoSave();
    return session;
  }

  /** All private sessions for a crew (normally 0–1; legacy duplicates possible). */
  findAllCrewPrivateSessions(crewId: string): Session[] {
    return this.listSessions(500).filter((s) =>
      !s.parentId
      && s.contextKind === 'crew_private'
      && s.hostCrewId === crewId,
    );
  }

  /** One lifelong private chat session per crew — returns existing or creates new. */
  findCrewPrivateSession(crewId: string): Session | null {
    const canonical = this.resolveCanonicalCrewPrivateSession(crewId);
    return canonical;
  }

  /**
   * Ensures exactly one crew_private session per crew.
   * If duplicates exist (legacy), keeps the richest/oldest and merges messages into it.
   */
  resolveCanonicalCrewPrivateSession(crewId: string): Session | null {
    const dupes = this.findAllCrewPrivateSessions(crewId);
    if (dupes.length === 0) return null;

    const scored = dupes.map((s) => ({
      session: s,
      messageCount: this.getSessionMessageCount(s.id),
    }));
    scored.sort((a, b) => {
      if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount;
      return String(a.session.createdAt ?? '').localeCompare(String(b.session.createdAt ?? ''));
    });

    const canonical = scored[0]!.session;
    for (const { session: dup } of scored.slice(1)) {
      this.mergeSessionMessagesInto(dup.id, canonical.id);
      this.deleteSessionRecord(dup.id);
    }
    return canonical;
  }

  private getSessionMessageCount(sessionId: string): number {
    if (this.usingStorageAdapter) {
      return (this.store as StorageAdapter).getMessageCount(sessionId);
    }
    return this.getSessionStore().getMessageCount(sessionId);
  }

  private mergeSessionMessagesInto(fromId: string, toId: string): void {
    const store = this.usingStorageAdapter
      ? (this.store as StorageAdapter)
      : this.getSessionStore();
    const getMsgs = (store as { getMessages?: (id: string) => Array<Record<string, unknown>> }).getMessages;
    const insert = (store as { insertMessage?: (msg: Record<string, unknown>) => void }).insertMessage;
    if (!getMsgs || !insert) return;
    const msgs = getMsgs.call(store, fromId).filter((m) => m['role'] === 'user' || m['role'] === 'assistant');
    for (const msg of msgs) {
      insert.call(store, {
        sessionId: toId,
        role: msg['role'],
        content: msg['content'],
        metadata: msg['metadata'],
        tokenCount: msg['token_count'] ?? msg['tokenCount'] ?? 0,
      });
    }
  }

  private deleteSessionRecord(sessionId: string): void {
    if (this.usingStorageAdapter) {
      (this.store as StorageAdapter).deleteSession(sessionId);
      return;
    }
    this.getSessionStore().deleteSession(sessionId);
  }

  createCrewPrivateSession(
    providerId: string,
    modelId: string,
    scopePath: string,
    crew: { id: string; name: string; callsign: string; title?: string },
  ): Session {
    const existing = this.resolveCanonicalCrewPrivateSession(crew.id);
    if (existing) return existing;

    const session = this.buildSessionRecord(
      providerId,
      modelId,
      scopePath,
      undefined,
      undefined,
      crew.name,
    );
    session.contextKind = 'crew_private';
    session.hostCrewId = crew.id;
    session.mode = 'agent';
    this.createSessionRecord(session);
    return session;
  }

  /** Register a child session without switching the active parent session. */
  createChildSessionRecord(
    childId: string,
    parentId: string,
    providerId: string,
    modelId: string,
    scopePath?: string,
    meta?: { kind?: string; label?: string },
  ): Session {
    const session = this.buildSessionRecord(
      providerId,
      modelId,
      scopePath,
      childId,
      parentId,
      meta?.label ?? 'Background work',
    );
    this.createSessionRecord(session);
    this.registerChildSessionEntry({
      id: childId,
      parentSessionId: parentId,
      kind: meta?.kind ?? 'sub_agent',
      label: meta?.label,
    });
    return session;
  }

  private registerChildSessionEntry(entry: {
    id: string;
    parentSessionId: string;
    kind: string;
    label?: string;
    status?: string;
  }): void {
    if (this.usingStorageAdapter) {
      const adapter = this.store as StorageAdapter;
      adapter.registerChildSession?.(entry);
      return;
    }
    const store = this.getSessionStore();
    if (typeof store.registerChildSession === 'function') {
      store.registerChildSession(entry);
    }
  }

  private buildSessionRecord(
    providerId: string,
    modelId: string,
    scopePath?: string,
    id?: string,
    parentId?: string,
    title?: string,
  ): Session {
    const contextWindow = 128_000;
    return {
      id: id ?? generateSessionId(),
      title: title ?? (parentId ? 'Background work' : 'New Session'),
      status: 'active' as SessionStatus,
      parentId: parentId ?? null,
      providerId,
      modelId,
      scopePath: scopePath!,
      mode: 'plan',
      tokenUsed: 0,
      tokenAvailable: contextWindow,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  getChildSessions(parentId: string): Session[] {
    if (this.usingStorageAdapter) {
      const adapter = this.store as StorageAdapter;
      if (adapter.listChildSessions) {
        return adapter.listChildSessions(parentId) as unknown as Session[];
      }
    }
    const store = this.getSessionStore();
    if (typeof store.listChildSessions === 'function') {
      return store.listChildSessions(parentId) as unknown as Session[];
    }
    const all = this.listSessions(9999);
    return all.filter(s => s.parentId === parentId);
  }

  getSessionListKpis(sessionId: string, base?: Record<string, unknown>): SessionListKpis {
    if (this.usingStorageAdapter) {
      const adapter = this.store as StorageAdapter;
      if (adapter.getSessionListKpis) {
        return adapter.getSessionListKpis(sessionId, base) as unknown as SessionListKpis;
      }
    } else {
      const store = this.getSessionStore();
      if (typeof store.getSessionListKpis === 'function') {
        return store.getSessionListKpis(sessionId, base) as unknown as SessionListKpis;
      }
    }
    return { ...EMPTY_SESSION_KPIS };
  }

  persistSessionFields(sessionId: string, updates: Record<string, unknown>): void {
    this.updateSessionRecord(sessionId, updates as Partial<Session>);
  }

  listRootSessions(limit = 20): Session[] {
    if (this.usingStorageAdapter) {
      const adapter = this.store as StorageAdapter;
      if (adapter.listRootSessions) {
        return adapter.listRootSessions(limit) as unknown as Session[];
      }
      return adapter.listSessions(limit).filter((s) => !s.parentId) as unknown as Session[];
    }
    return this.getSessionStore().listRootSessions(limit) as unknown as Session[];
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

  /** Load session metadata without switching the active Agent-X session pointer. */
  getSessionById(sessionId: string): Session | null {
    return this.getSessionRecord(sessionId);
  }

  replayEvents(sessionId: string, sinceSequence?: number): Generator<SessionEvent, void, undefined> {
    if (this.usingStorageAdapter) {
      const adapter = this.store as any;
      if (typeof adapter.getSessionEvents === 'function') {
        const events = adapter.getSessionEvents(sessionId, sinceSequence) as SessionEvent[];
        let idx = 0;
        return {
          next: () => {
            if (idx >= events.length) return { value: undefined, done: true };
            return { value: events[idx++], done: false };
          },
          [Symbol.iterator]() { return this; },
        } as Generator<SessionEvent, void, undefined>;
      }
      return {
        next: () => ({ value: undefined, done: true }),
        [Symbol.iterator]() { return this; },
      } as unknown as Generator<SessionEvent, void, undefined>;
    }
    return this.getSessionStore().replayEvents(sessionId, sinceSequence);
  }

  getSessionEvents(sessionId: string, sinceSequence?: number): SessionEvent[] {
    if (this.usingStorageAdapter) {
      const adapter = this.store as any;
      if (typeof adapter.getSessionEvents === 'function') {
        return adapter.getSessionEvents(sessionId, sinceSequence) as SessionEvent[];
      }
      return [];
    }
    return this.getSessionStore().getSessionEvents(sessionId, sinceSequence);
  }

  saveCrewState(crewId: string, enabled: boolean, messageCount?: number): void {
    if (!this.activeSession) return;
    
    const state = {
      id: generateId(),
      sessionId: this.activeSession.id,
      crewId,
      enabled,
      lastActive: new Date().toISOString(),
      messageCount: messageCount ?? 0,
    };
    
    if (this.usingStorageAdapter) {
      const adapter = this.store as any;
      if (typeof adapter.saveCrewState === 'function') {
        adapter.saveCrewState(state);
      }
      return;
    }
    
    this.getSessionStore().saveCrewState(state);
  }

  getCrewStates(): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    if (!this.activeSession) return [];
    
    if (this.usingStorageAdapter) {
      const adapter = this.store as any;
      if (typeof adapter.loadCrewStates === 'function') {
        return adapter.loadCrewStates(this.activeSession.id) as Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }>;
      }
      return [];
    }
    
    const rows = this.getSessionStore().getCrewStates(this.activeSession.id);
    return rows.map((row) => ({
      crewId: row['crew_id'] as string,
      enabled: (row['enabled'] as number) === 1,
      lastActive: row['last_active'] as string | undefined,
      messageCount: row['message_count'] as number | undefined,
    }));
  }

  loadCrewStates(sessionId: string): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    if (this.usingStorageAdapter) {
      const adapter = this.store as any;
      if (typeof adapter.loadCrewStates === 'function') {
        return adapter.loadCrewStates(sessionId) as Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }>;
      }
      return [];
    }
    const rows = this.getSessionStore().getCrewStates(sessionId);
    return rows.map((row) => ({
      crewId: row['crew_id'] as string,
      enabled: (row['enabled'] as number) === 1,
      lastActive: row['last_active'] as string | undefined,
      messageCount: row['message_count'] as number | undefined,
    }));
  }

  restoreCrewStates(): Array<{ crewId: string; enabled: boolean }> {
    if (!this.activeSession) return [];
    return this.loadCrewStates(this.activeSession.id).map((s) => ({
      crewId: s.crewId,
      enabled: s.enabled,
    }));
  }

  listSessions(limit = 20): Session[] {
    return this.listSessionRecords(limit);
  }

  addTokenLog(opts: { sessionId: string; inputTokens: number; outputTokens: number; model: string; costUsd: number; providerId: string; crewId?: string }): void {
    const log: Record<string, unknown> = {
      sessionId: opts.sessionId,
      model: opts.model,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd: opts.costUsd,
      providerId: opts.providerId,
      crewId: opts.crewId || null,
    };
    if (this.usingStorageAdapter) {
      (this.store as StorageAdapter).addTokenLog(opts.sessionId, log as any);
    } else {
      this.getSessionStore().addTokenLog({ id: crypto.randomUUID(), sessionId: opts.sessionId, providerId: opts.providerId, modelId: opts.model, inputTokens: opts.inputTokens, outputTokens: opts.outputTokens, costUsd: opts.costUsd, crewId: opts.crewId });
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
    if (this.usingStorageAdapter) {
      const adapter = this.store as any;
      if (typeof adapter.addToolExecution === 'function') {
        adapter.addToolExecution(exec);
      }
      return;
    }
    this.getSessionStore().addToolExecution(exec);
  }

  private startAutoSave(): void {
    this.stopAutoSave();
    this.autoSaveInterval = setInterval(() => {
      if (this.activeSession && this.tokenTracker) {
        this.updateSessionRecord(this.activeSession.id, {
          tokensUsed: this.tokenTracker.tokensUsed,
          updatedAt: new Date().toISOString(),
        } as Partial<Session>);
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
