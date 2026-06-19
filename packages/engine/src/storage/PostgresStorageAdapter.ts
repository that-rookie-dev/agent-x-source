import { Pool, type PoolConfig } from 'pg';
import { generateId } from '@agentx/shared';
import type {
  StorageAdapter,
  StorableSession,
  StorableMessage,
  StorableTokenLog,
  StorablePermission,
  RecordMeta,
} from '@agentx/shared';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Session',
  status TEXT NOT NULL DEFAULT 'active',
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  crew_id TEXT,
  scope_path TEXT NOT NULL DEFAULT '/',
  token_used INTEGER DEFAULT 0,
  token_available INTEGER NOT NULL DEFAULT 128000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  token_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  target_path TEXT,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_session ON token_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_permissions_session ON permissions(session_id);
`;

interface CacheState {
  sessions: Map<string, StorableSession>;
  messages: Map<string, StorableMessage[]>;
}

export interface PostgresConfig extends PoolConfig {
  autoMigrate?: boolean;
}

export class PostgresStorageAdapter implements StorageAdapter {
  private pool: Pool;
  private connected = false;
  private cache: CacheState = { sessions: new Map(), messages: new Map() };

  constructor(config: PostgresConfig) {
    this.pool = new Pool(config);
  }

  static async testConnection(connectionString: string): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString, max: 1 });
      const client = await pool.connect();
      const result = await client.query('SELECT version() as version');
      const pgVersion = result.rows[0]?.['version'] as string;
      client.release();
      await pool.end();
      return { ok: true, version: pgVersion || 'connected' };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : 'connection-failed' };
    }
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();
      this.connected = true;
      await this.migrate();
      await this.hydrateCache();
      logger.info('PG_CONNECTED', 'PostgreSQL connection established');
    } catch (error) {
      logger.error('PG_CONNECT_FAILED', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      client.release();
    }
  }

  createSession(input: Omit<StorableSession, keyof RecordMeta>): StorableSession {
    const id = generateId();
    const now = new Date().toISOString();
    const session: StorableSession = { id, ...input, createdAt: now, updatedAt: now };
    this.cache.sessions.set(id, session);
    this.write('INSERT INTO sessions (id,title,status,provider_id,model_id,crew_id,scope_path,token_used,token_available,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, input.title, input.status, input.providerId, input.modelId, input.crewId, input.scopePath, input.tokenUsed, input.tokenAvailable, now, now]);
    return session;
  }

  getSession(id: string): StorableSession | null {
    return this.cache.sessions.get(id) ?? null;
  }

  updateSession(id: string, updates: Partial<StorableSession>): void {
    const cached = this.cache.sessions.get(id);
    if (cached) Object.assign(cached, updates, { updatedAt: new Date().toISOString() });

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const map: Record<string, string> = {
      title: 'title', status: 'status', providerId: 'provider_id',
      modelId: 'model_id', crewId: 'crew_id', scopePath: 'scope_path',
      tokenUsed: 'token_used', tokenAvailable: 'token_available',
    };
    for (const [key, col] of Object.entries(map)) {
      if (key in updates) {
        fields.push(`${col} = $${idx++}`);
        values.push((updates as Record<string, unknown>)[key]);
      }
    }
    if (fields.length === 0) return;
    fields.push('updated_at = NOW()');
    values.push(id);
    this.write(`UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }

  deleteSession(id: string): void {
    this.cache.sessions.delete(id);
    this.cache.messages.delete(id);
    this.write('DELETE FROM sessions WHERE id = $1', [id]);
  }

  listSessions(limit = 20): StorableSession[] {
    return [...this.cache.sessions.values()]
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, limit);
  }

  addMessage(sessionId: string, message: Omit<StorableMessage, 'id' | 'createdAt'>): StorableMessage {
    const id = generateId();
    const now = new Date().toISOString();
    const msg: StorableMessage = { id, ...message, createdAt: now };
    const msgs = this.cache.messages.get(sessionId) ?? [];
    msgs.push(msg);
    this.cache.messages.set(sessionId, msgs);
    this.write('INSERT INTO messages (id,session_id,role,content,tool_calls,token_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, sessionId, msg.role, msg.content, msg.toolCalls ?? null, msg.tokenCount, now]);
    return msg;
  }

  getMessages(sessionId: string): StorableMessage[] {
    return [...(this.cache.messages.get(sessionId) ?? [])];
  }

  deleteMessages(sessionId: string): void {
    this.cache.messages.delete(sessionId);
    this.write('DELETE FROM messages WHERE session_id = $1', [sessionId]);
  }

  getMessageCount(sessionId: string): number {
    return (this.cache.messages.get(sessionId) ?? []).length;
  }

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void {
    this.write('INSERT INTO token_logs (id,session_id,provider_id,model_id,input_tokens,output_tokens) VALUES ($1,$2,$3,$4,$5,$6)', [generateId(), sessionId, (log as any).providerId || 'unknown', log.model, log.inputTokens, log.outputTokens]);
  }

  getTokenLogs(_sessionId: string): StorableTokenLog[] {
    return [];  // PG adapter is async; use getTokenLogsAsync
  }

  async getTokenLogsAsync(sessionId: string): Promise<StorableTokenLog[]> {
    try {
      const result = await this.pool.query(
        `SELECT id,session_id as "sessionId",provider_id,model_id as "model",input_tokens as "inputTokens",output_tokens as "outputTokens",created_at as "createdAt"
         FROM token_logs WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]
      );
      return result.rows as StorableTokenLog[];
    } catch { return []; }
  }

  addPermission(sessionId: string, perm: Omit<StorablePermission, 'id' | 'createdAt'>): void {
    this.write('INSERT INTO permissions (id,session_id,tool_name,target_path,decision) VALUES ($1,$2,$3,$4,$5)', [generateId(), sessionId, perm.toolName, perm.targetPath, perm.decision]);
  }

  getPermissions(_sessionId: string): StorablePermission[] {
    return [];  // PG adapter is async; use getPermissionsAsync
  }

  async getPermissionsAsync(sessionId: string): Promise<StorablePermission[]> {
    try {
      const result = await this.pool.query(
        `SELECT id,session_id as "sessionId",tool_name as "toolName",target_path as "targetPath",decision,created_at as "createdAt"
         FROM permissions WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]
      );
      return result.rows as StorablePermission[];
    } catch { return []; }
  }

  clearAll(): void {
    this.cache.sessions.clear();
    this.cache.messages.clear();
    this.write('TRUNCATE sessions CASCADE');
  }

  close(): void {
    this.pool.end().catch(() => {});
  }

  private async write(sql: string, params: unknown[] = []): Promise<void> {
    try {
      await this.pool.query(sql, params);
    } catch (error) {
      logger.error('PG_WRITE_ERROR', error, { sql: sql.slice(0, 100) });
    }
  }

  private async hydrateCache(): Promise<void> {
    try {
      const sessions = await this.pool.query(
        `SELECT id,title,status,provider_id as "providerId",model_id as "modelId",crew_id as "crewId",
                scope_path as "scopePath",token_used as "tokenUsed",token_available as "tokenAvailable",created_at as "createdAt",updated_at as "updatedAt"
         FROM sessions`,
      );
      for (const row of sessions.rows) {
        this.cache.sessions.set((row as StorableSession).id, row as StorableSession);
      }

      const messages = await this.pool.query(
        `SELECT id,session_id as "sessionId",role,content,tool_calls as "toolCalls",token_count as "tokenCount",created_at as "createdAt"
         FROM messages ORDER BY created_at ASC`,
      );
      for (const row of messages.rows) {
        const msg = row as StorableMessage;
        const msgs = this.cache.messages.get(msg.sessionId) ?? [];
        msgs.push(msg);
        this.cache.messages.set(msg.sessionId, msgs);
      }
    } catch (error) {
      logger.error('PG_HYDRATE_FAILED', error);
    }
  }
}
