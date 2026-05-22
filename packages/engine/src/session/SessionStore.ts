import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDbPath } from '../config/paths.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT 'New Session',
    profile_id  TEXT,
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    scope_path  TEXT NOT NULL,
    token_used  INTEGER DEFAULT 0,
    token_available INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    tool_calls  TEXT,
    token_count INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS permissions (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    tool_name   TEXT NOT NULL,
    target_path TEXT,
    decision    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS token_logs (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    message_id  TEXT,
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    reasoning_tokens INTEGER DEFAULT 0,
    cost_usd    REAL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    parent_id   TEXT,
    instruction TEXT NOT NULL,
    tools       TEXT,
    scope       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',
    result      TEXT,
    started_at  TEXT,
    completed_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    expertise   TEXT,
    traits      TEXT,
    tool_preferences TEXT,
    enabled_tools TEXT,
    disabled_tools TEXT,
    is_default  INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_registry (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    risk_level  TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'builtin',
    enabled     INTEGER DEFAULT 1,
    schema      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_executions (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    agent_task_id TEXT,
    tool_name   TEXT NOT NULL,
    input       TEXT NOT NULL,
    output      TEXT,
    success     INTEGER,
    elapsed_ms  INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS commands (
    name        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'general',
    aliases     TEXT,
    enabled     INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_permissions_session ON permissions(session_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_session ON token_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_profiles_default ON profiles(is_default);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON tool_executions(session_id);
`;

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? getDbPath();
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(SCHEMA_SQL);
  }

  getDb(): Database.Database {
    return this.db;
  }

  createSession(session: {
    id: string;
    title: string;
    status: string;
    provider: string;
    model: string;
    profileId?: string | null;
    tokensUsed?: number;
    tokenAvailable?: number;
    scopePath?: string;
    createdAt: string;
    updatedAt: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, title, status, provider_id, model_id, profile_id, token_used, token_available, scope_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.title,
      session.status,
      session.provider,
      session.model,
      session.profileId ?? null,
      session.tokensUsed ?? 0,
      session.tokenAvailable ?? 128000,
      session.scopePath ?? process.cwd(),
      session.createdAt,
      session.updatedAt,
    );
  }

  getSession(sessionId: string): Record<string, unknown> | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row['id'],
      title: row['title'],
      status: row['status'],
      provider: row['provider_id'],
      model: row['model_id'],
      profileId: row['profile_id'],
      tokensUsed: row['token_used'],
      scopePath: row['scope_path'],
      createdAt: row['created_at'],
      updatedAt: row['updated_at'],
    };
  }

  updateSession(sessionId: string, updates: Record<string, unknown>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    const columnMap: Record<string, string> = {
      title: 'title',
      status: 'status',
      provider: 'provider_id',
      model: 'model_id',
      profileId: 'profile_id',
      tokensUsed: 'token_used',
      scopePath: 'scope_path',
      updatedAt: 'updated_at',
    };

    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        fields.push(`${col} = ?`);
        values.push(updates[key]);
      }
    }

    if (fields.length === 0) return;
    values.push(sessionId);

    const stmt = this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  listSessions(limit = 20): Array<Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?');
    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row['id'],
      title: row['title'],
      status: row['status'],
      provider: row['provider_id'],
      model: row['model_id'],
      profileId: row['profile_id'],
      tokensUsed: row['token_used'],
      scopePath: row['scope_path'],
      createdAt: row['created_at'],
      updatedAt: row['updated_at'],
    }));
  }

  addMessage(message: {
    id: string;
    sessionId: string;
    role: string;
    content: string;
    tokenCount?: number;
    toolCalls?: string;
    createdAt: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, token_count, tool_calls, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.tokenCount ?? 0,
      message.toolCalls ?? null,
      message.createdAt,
    );
  }

  getMessages(sessionId: string): Array<Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId) as Array<Record<string, unknown>>;
  }

  deleteMessages(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    stmt.run(sessionId);
  }

  getMessageCount(sessionId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?');
    const row = stmt.get(sessionId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  addTokenLog(log: {
    id: string;
    sessionId: string;
    messageId?: string;
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    costUsd?: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO token_logs (id, session_id, message_id, provider_id, model_id, input_tokens, output_tokens, reasoning_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      log.id,
      log.sessionId,
      log.messageId ?? null,
      log.providerId,
      log.modelId,
      log.inputTokens,
      log.outputTokens,
      log.reasoningTokens ?? 0,
      log.costUsd ?? null,
    );
  }

  getTokenLogs(sessionId: string): Array<Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT * FROM token_logs WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId) as Array<Record<string, unknown>>;
  }

  addToolExecution(exec: {
    id: string;
    sessionId: string;
    agentTaskId?: string;
    toolName: string;
    input: string;
    output?: string;
    success?: boolean;
    elapsedMs?: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO tool_executions (id, session_id, agent_task_id, tool_name, input, output, success, elapsed_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      exec.id,
      exec.sessionId,
      exec.agentTaskId ?? null,
      exec.toolName,
      exec.input,
      exec.output ?? null,
      exec.success != null ? (exec.success ? 1 : 0) : null,
      exec.elapsedMs ?? null,
    );
  }

  addPermission(perm: {
    id: string;
    sessionId: string;
    toolName: string;
    targetPath?: string;
    decision: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO permissions (id, session_id, tool_name, target_path, decision)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(perm.id, perm.sessionId, perm.toolName, perm.targetPath ?? null, perm.decision);
  }

  getPermissions(sessionId: string): Array<Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT * FROM permissions WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId) as Array<Record<string, unknown>>;
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM tool_executions WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM token_logs WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM permissions WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM agent_tasks WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}
