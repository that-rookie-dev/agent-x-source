import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface SQLiteBrowserConfig {
  readOnly: boolean;
}

/** Minimal interface matching SessionStore for type safety without runtime import */
interface StoreLike {
  listSessions(): Array<{ id: string; title: string; model: string; messageCount: number; tokenUsed: number; createdAt: string }>;
  getMessages(sessionId: string, limit: number): Array<{ id: string; role: string; content: string; tokenCount: number; createdAt: string }>;
  getTokenLogs?(): Array<{ inputTokens: number; outputTokens: number; cost: number }>;
  clearSession?(sessionId: string): boolean;
  executeQuery?(sql: string): { columns: string[]; rows: Array<Record<string, unknown>> };
}

export class SQLiteBrowserRuntime {
  private config: SQLiteBrowserConfig;
  private store: StoreLike | null = null;

  constructor(config: Partial<SQLiteBrowserConfig> = {}, store?: StoreLike) {
    this.config = {
      readOnly: config.readOnly ?? true,
    };
    this.store = store ?? null;
    logger.info('SQLITE_BROWSER', `Initialized (readOnly: ${this.config.readOnly})`);
  }

  setStore(store: StoreLike): void {
    this.store = store;
  }

  /**
   * List all sessions with metadata.
   */
  listSessions(): Array<{
    id: string;
    title: string;
    model: string;
    messageCount: number;
    tokenUsed: number;
    createdAt: string;
  }> {
    if (!this.store) return [];
    return this.store.listSessions();
  }

  /**
   * Get messages for a specific session.
   */
  getMessages(sessionId: string, limit = 100): Array<{
    id: string;
    role: string;
    content: string;
    tokenCount: number;
    createdAt: string;
  }> {
    if (!this.store) return [];
    return this.store.getMessages(sessionId, limit);
  }

  /**
   * Get token usage stats across all sessions.
   */
  getTokenStats(): { totalInput: number; totalOutput: number; totalCost: number; sessionCount: number } {
    if (!this.store) return { totalInput: 0, totalOutput: 0, totalCost: 0, sessionCount: 0 };
    const logs = this.store.getTokenLogs?.() || [];
    if (logs.length === 0) {
      const sessions = this.store.listSessions();
      return {
        totalInput: sessions.reduce((s: number, x: { tokenUsed?: number }) => s + (x.tokenUsed || 0), 0),
        totalOutput: 0,
        totalCost: 0,
        sessionCount: sessions.length,
      };
    }
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    for (const log of logs) {
      totalInput += log.inputTokens || 0;
      totalOutput += log.outputTokens || 0;
      totalCost += log.cost || 0;
    }
    return { totalInput, totalOutput, totalCost, sessionCount: logs.length };
  }

  /**
   * Delete messages for a session (if not read-only).
   */
  deleteMessages(sessionId: string): boolean {
    if (this.config.readOnly || !this.store) return false;
    return this.store.clearSession?.(sessionId) ?? false;
  }

  /**
   * Execute a raw SQL query (if not read-only).
   */
  executeQuery(sql: string): { columns: string[]; rows: Array<Record<string, unknown>> } | { error: string } {
    if (!this.store) return { error: 'No store configured' };
    if (this.config.readOnly && !sql.trim().toUpperCase().startsWith('SELECT')) {
      return { error: 'Write operations disabled in read-only mode' };
    }
    try {
      return this.store.executeQuery?.(sql) ?? { columns: [], rows: [] };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  getConfig(): SQLiteBrowserConfig {
    return { ...this.config };
  }
}
