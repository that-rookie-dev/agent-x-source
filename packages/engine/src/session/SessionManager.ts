import type { Session, SessionStatus } from '@agentx/shared';
import { generateSessionId } from '@agentx/shared';
import { SessionStore } from './SessionStore.js';
import { TokenTracker } from './TokenTracker.js';

export interface SessionManagerOptions {
  dbPath?: string;
}

export class SessionManager {
  private store: SessionStore;
  private activeSession: Session | null = null;
  private tokenTracker: TokenTracker | null = null;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionManagerOptions = {}) {
    this.store = new SessionStore(options.dbPath);
  }

  createSession(providerId: string, modelId: string, profileId?: string, scopePath?: string): Session {
    const contextWindow = 128_000;
    const session: Session = {
      id: generateSessionId(),
      title: 'New Session',
      status: 'active' as SessionStatus,
      providerId,
      modelId,
      profileId: profileId ?? null,
      scopePath: scopePath ?? process.cwd(),
      tokenUsed: 0,
      tokenAvailable: contextWindow,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.createSession({
      id: session.id,
      title: session.title,
      status: session.status,
      provider: session.providerId,
      model: session.modelId,
      profileId: session.profileId,
      tokensUsed: session.tokenUsed,
      tokenAvailable: contextWindow,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
    this.activeSession = session;
    this.tokenTracker = new TokenTracker(contextWindow);

    // Auto-save every 30 seconds
    this.startAutoSave();

    return session;
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
    this.store.updateSession(this.activeSession.id, updates);
  }

  async endSession(): Promise<void> {
    if (!this.activeSession) return;
    this.stopAutoSave();
    this.updateSession({ status: 'completed' as SessionStatus });
    this.activeSession = null;
    this.tokenTracker = null;
  }

  restoreSession(sessionId: string): Session | null {
    const row = this.store.getSession(sessionId);
    if (row) {
      const session = row as unknown as Session;
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

  listSessions(limit = 20): Session[] {
    return this.store.listSessions(limit) as unknown as Session[];
  }

  private startAutoSave(): void {
    this.stopAutoSave();
    this.autoSaveInterval = setInterval(() => {
      if (this.activeSession && this.tokenTracker) {
        this.store.updateSession(this.activeSession.id, {
          tokensUsed: this.tokenTracker.tokensUsed,
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
