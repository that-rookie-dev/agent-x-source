import type { Session, SessionStatus, SessionEvent, StorableTokenLog, StorableSession } from '@agentx/shared';
import type { StorageAdapter } from '@agentx/shared';
import { generateSessionId, generateId } from '@agentx/shared';
import { TokenTracker } from './TokenTracker.js';
import { normalizeSessionUpdates, EMPTY_SESSION_KPIS, hostCrewSnapshotFromInput, hostCrewSnapshotPatch } from './session-field-utils.js';
import type { SessionListKpis } from './session-field-utils.js';

export interface SessionManagerOptions {
  storageAdapter: StorageAdapter;
}

export class SessionManager {
  private store: StorageAdapter;
  private activeSession: Session | null = null;
  private tokenTracker: TokenTracker | null = null;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionManagerOptions) {
    this.store = options.storageAdapter;
  }

  /**
   * Inject the Data Encryption Key for encrypting sensitive session data at rest.
   * Must be called after successful authentication to enable field-level encryption.
   */
  setDEK(_dek: Buffer | null): void {
  }

  /** Expose the underlying storage adapter for callers that need adapter-specific methods (e.g. insertMessage, insertPart). */
  getStorageAdapter(): StorageAdapter {
    return this.store;
  }

  private createSessionRecord(session: Session): void {
    this.store.createSession({
      id: session.id,
      title: session.title,
      status: session.status,
      providerId: session.providerId,
      modelId: session.modelId,
      scopePath: session.scopePath,
      parentId: session.parentId,
      tokenUsed: session.tokenUsed,
      tokenAvailable: session.tokenAvailable,
      contextKind: session.contextKind ?? 'agent_x',
      hostCrewId: session.hostCrewId ?? null,
      hostCrewName: session.hostCrewName ?? null,
      hostCrewCallsign: session.hostCrewCallsign ?? null,
      hostCrewTitle: session.hostCrewTitle ?? null,
      hostCrewColor: session.hostCrewColor ?? null,
      hostCrewCatalogId: session.hostCrewCatalogId ?? null,
      hostCrewCategoryId: session.hostCrewCategoryId ?? null,
    });
  }

  private updateSessionRecord(id: string, updates: Partial<Session>): void {
    const normalized = normalizeSessionUpdates(updates as Record<string, unknown>);
    this.store.updateSession(id, normalized as Partial<Session>);
  }

  private castSession(raw: StorableSession): Session {
    return {
      ...raw,
      updatedAt: raw.updatedAt ?? raw.createdAt,
      status: raw.status as SessionStatus,
    } as Session;
  }

  private getSessionRecord(id: string): Session | null {
    const raw = this.store.getSession(id);
    return raw ? this.castSession(raw) : null;
  }

  private listSessionRecords(limit = 20): Session[] {
    return this.store.listSessions(limit).map((s) => this.castSession(s));
  }

  createSession(providerId: string, modelId: string, scopePath?: string, id?: string, parentId?: string): Session {
    const session = this.buildSessionRecord(providerId, modelId, scopePath, id, parentId);
    this.createSessionRecord(session);
    this.activeSession = session;
    this.tokenTracker = new TokenTracker(session.tokenAvailable || 128_000);
    this.startAutoSave();
    return session;
  }

  /**
   * Internal run container for scheduled automation — not a user chat session.
   * Does not change the active session or hijack the global agent slot.
   */
  ensureAutomationRunSession(
    taskId: string,
    providerId: string,
    modelId: string,
    scopePath: string,
    title: string,
  ): Session {
    const sessionId = `automation:${taskId}`;
    const prevActive = this.activeSession;
    const prevTracker = this.tokenTracker;
    const wasAutoSave = !!this.autoSaveInterval;

    try {
      let session = this.getSessionRecord(sessionId);
      if (!session) {
        session = {
          ...this.buildSessionRecord(providerId, modelId, scopePath, sessionId, undefined, title),
          contextKind: 'automation',
        };
        this.createSessionRecord(session);
      }
      return session;
    } finally {
      this.activeSession = prevActive;
      this.tokenTracker = prevTracker;
      if (!wasAutoSave && this.autoSaveInterval) {
        clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = null;
      }
    }
  }

  /** One lifelong private chat session per crew — returns existing or null. */
  findCrewPrivateSession(crewId: string): Session | null {
    return this.listSessions(500).find((s) =>
      !s.parentId
      && s.contextKind === 'crew_private'
      && s.hostCrewId === crewId,
    ) ?? null;
  }

  /** The global Agent-X core session — never deleted, used for voice and lifelong learning. */
  findAgentXCoreSession(): Session | null {
    return this.listSessions(500).find((s) =>
      !s.parentId && s.contextKind === 'agent_x_core',
    ) ?? null;
  }

  /** Create the core session record without hijacking the active user session. */
  ensureAgentXCoreSession(
    providerId: string,
    modelId: string,
    scopePath: string,
  ): Session {
    const existing = this.findAgentXCoreSession();
    if (existing) {
      return existing;
    }

    const prevActive = this.activeSession;
    const prevTracker = this.tokenTracker;
    const wasAutoSave = !!this.autoSaveInterval;

    try {
      const session = this.buildSessionRecord(
        providerId,
        modelId,
        scopePath,
        undefined,
        undefined,
        'Agent-X',
      );
      session.contextKind = 'agent_x_core';
      this.createSessionRecord(session);
      return session;
    } finally {
      this.activeSession = prevActive;
      this.tokenTracker = prevTracker;
      if (!wasAutoSave && this.autoSaveInterval) {
        clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = null;
      }
    }
  }

  createCrewPrivateSession(
    providerId: string,
    modelId: string,
    scopePath: string,
    crew: {
      id: string;
      name: string;
      callsign: string;
      title?: string;
      color?: string;
      catalogId?: string;
      categoryId?: string;
      expertise?: string[];
      requiresMedicalDisclaimer?: boolean;
      honorsDoctorate?: boolean;
    },
  ): Session {
    const existing = this.findCrewPrivateSession(crew.id);
    if (existing) {
      const patch = hostCrewSnapshotPatch(existing, crew);
      if (Object.keys(patch).length > 0) {
        this.patchSession(existing.id, patch as Partial<Session>);
      }
      return { ...existing, ...patch };
    }

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
    Object.assign(session, hostCrewSnapshotFromInput(crew));
    this.createSessionRecord(session);
    return session;
  }

  patchSession(sessionId: string, updates: Partial<Session>): void {
    this.updateSessionRecord(sessionId, updates);
    if (this.activeSession?.id === sessionId) {
      this.activeSession = { ...this.activeSession, ...updates, updatedAt: new Date().toISOString() };
    }
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
    this.store.registerChildSession?.(entry);
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
      tokenUsed: 0,
      tokenAvailable: contextWindow,
      bypassPermissions: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  getChildSessions(parentId: string): Session[] {
    if (this.store.listChildSessions) {
      return this.store.listChildSessions(parentId).map((s) => this.castSession(s));
    }
    const all = this.listSessions(9999);
    return all.filter(s => s.parentId === parentId);
  }

  getSessionListKpis(sessionId: string, base?: Session | Record<string, unknown>): SessionListKpis {
    if (this.store.getSessionListKpis) {
      return this.store.getSessionListKpis(sessionId, base);
    }
    return { ...EMPTY_SESSION_KPIS };
  }

  persistSessionFields(sessionId: string, updates: Record<string, unknown>): void {
    this.updateSessionRecord(sessionId, updates as Partial<Session>);
  }

  listRootSessions(limit = 20): Session[] {
    const filterAutomation = (sessions: Session[]) =>
      sessions.filter((s) => {
        if (s.parentId) return false;
        if ((s.contextKind ?? 'agent_x') === 'automation') return false;
        if ((s.contextKind ?? 'agent_x') === 'agent_x_core') return false;
        if (s.id.startsWith('automation:')) return false;
        return true;
      });
    if (this.store.listRootSessions) {
      return filterAutomation(this.store.listRootSessions(limit).map((s) => this.castSession(s)));
    }
    return filterAutomation(this.store.listSessions(limit).map((s) => this.castSession(s)));
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

  /** Keep the active session row aligned with the global runtime provider/model. */
  syncActiveSessionRuntime(updates: Partial<Pick<Session, 'providerId' | 'modelId'>>): void {
    if (!this.activeSession) return;
    const patch: Partial<Session> = {};
    if (updates.providerId && updates.providerId !== this.activeSession.providerId) {
      patch.providerId = updates.providerId;
    }
    if (updates.modelId && updates.modelId !== this.activeSession.modelId) {
      patch.modelId = updates.modelId;
    }
    if (Object.keys(patch).length === 0) return;
    this.updateSession(patch);
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
    const events = this.store.getSessionEvents?.(sessionId, sinceSequence) ?? [];
    let idx = 0;
    return {
      next: () => {
        if (idx >= events.length) return { value: undefined, done: true };
        return { value: events[idx++], done: false };
      },
      [Symbol.iterator]() { return this; },
    } as Generator<SessionEvent, void, undefined>;
  }

  getSessionEvents(sessionId: string, sinceSequence?: number): SessionEvent[] {
    return this.store.getSessionEvents?.(sessionId, sinceSequence) ?? [];
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

    this.store.saveCrewState?.(state);
  }

  getCrewStates(): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    if (!this.activeSession) return [];
    return this.store.loadCrewStates?.(this.activeSession.id) ?? [];
  }

  loadCrewStates(sessionId: string): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    return this.store.loadCrewStates?.(sessionId) ?? [];
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
    const log: Omit<StorableTokenLog, 'id' | 'createdAt'> = {
      sessionId: opts.sessionId,
      model: opts.model,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd: opts.costUsd,
      providerId: opts.providerId,
      crewId: opts.crewId || null,
    };
    this.store.addTokenLog(opts.sessionId, log);
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
    this.store.addToolExecution?.(exec);
  }

  private startAutoSave(): void {
    this.stopAutoSave();
    this.autoSaveInterval = setInterval(() => {
      if (this.activeSession && this.tokenTracker) {
        this.updateSessionRecord(this.activeSession.id, {
          tokenUsed: this.tokenTracker.tokensUsed,
          updatedAt: new Date().toISOString(),
        });
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
    this.store.close();
  }
}
