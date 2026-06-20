import { mkdirSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'module';
import { getDbPath } from '../config/paths.js';
import { getLogger } from '@agentx/shared';
import type { SessionEvent, Crew, CrewCreateInput } from '@agentx/shared';

// Try to load better-sqlite3, but don't crash if native bindings are missing.
let BetterSqlite3: any = null;
try {
  const require = createRequire(import.meta.url);
   
  BetterSqlite3 = require('better-sqlite3');
} catch (err) {
  BetterSqlite3 = null;
}

const CURRENT_SCHEMA_VERSION = 15;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS _schema (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT 'New Session',
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    scope_path  TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'plan',
    parent_id   TEXT REFERENCES sessions(id),
    hyperdrive  INTEGER NOT NULL DEFAULT 0,
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
    plan        TEXT,
    parts       TEXT,
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

CREATE TABLE IF NOT EXISTS crews (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT '',
    title           TEXT,
    description     TEXT NOT NULL DEFAULT '',
    system_prompt   TEXT NOT NULL DEFAULT '',
    expertise       TEXT,
    traits          TEXT,
    tool_preferences TEXT,
    enabled_tools   TEXT,
    disabled_tools  TEXT,
    is_default      INTEGER DEFAULT 0,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_crew_states (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    crew_id     TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_active TEXT,
    message_count INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    UNIQUE(session_id, crew_id)
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

CREATE TABLE IF NOT EXISTS permission_rules (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    action      TEXT NOT NULL,
    pattern     TEXT NOT NULL DEFAULT '*',
    effect      TEXT NOT NULL,
    comment     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
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
CREATE INDEX IF NOT EXISTS idx_crews_default ON crews(is_default);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON tool_executions(session_id);

CREATE TABLE IF NOT EXISTS message_parts (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    type        TEXT NOT NULL,
    content     TEXT,
    tool_name   TEXT,
    tool_call_id TEXT,
    tool_args   TEXT,
    tool_result TEXT,
    tool_success INTEGER,
    usage_input INTEGER,
    usage_output INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_parts_session ON message_parts(session_id);

CREATE TABLE IF NOT EXISTS checkpoints (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    label       TEXT NOT NULL,
    messages    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);

CREATE TABLE IF NOT EXISTS agent_persona (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    communication_style TEXT NOT NULL DEFAULT 'direct',
    decision_making     TEXT NOT NULL DEFAULT 'balanced',
    domain_context      TEXT NOT NULL DEFAULT '',
    traits  TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const MIGRATIONS: Array<{ version: number; description: string; run: (db: any) => void }> = [
  {
    version: 1,
    description: 'Baseline schema (all current tables + indexes)',
    run: () => { /* baseline — tables already created by SCHEMA_SQL */ },
  },
  {
    version: 2,
    description: 'Add message_parts table for AI SDK part-level persistence',
    run: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_parts (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            type        TEXT NOT NULL,
            content     TEXT,
            tool_name   TEXT,
            tool_call_id TEXT,
            tool_args   TEXT,
            tool_result TEXT,
            tool_success INTEGER,
            usage_input INTEGER,
            usage_output INTEGER,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_parts_session ON message_parts(session_id);
      `);
    },
  },
  {
    version: 3,
    description: 'Add plan column to messages table for plan persistence',
    run: (db: any) => {
      try { db.exec(`ALTER TABLE messages ADD COLUMN plan TEXT`); } catch { /* column may already exist */ }
    },
  },
  {
    version: 4,
    description: 'Add metadata column to messages table for crew response metadata',
    run: (db: any) => {
      db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
    },
  },
  {
    version: 5,
    description: 'Add crew_id column to token_logs table for crew-specific token tracking',
    run: (db: any) => {
      db.exec(`ALTER TABLE token_logs ADD COLUMN crew_id TEXT`);
    },
  },
  {
    version: 6,
    description: 'Add session_events table for durable event sourcing',
    run: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_events (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            sequence    INTEGER NOT NULL,
            event_type  TEXT NOT NULL,
            payload     TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, sequence);
      `);
    },
  },
  {
    version: 7,
    description: 'Add permission_rules table for PermissionRule persistence',
    run: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS permission_rules (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            action      TEXT NOT NULL,
            pattern     TEXT NOT NULL DEFAULT '*',
            effect      TEXT NOT NULL,
            comment     TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_permission_rules_session ON permission_rules(session_id);
      `);
    },
  },
  {
    version: 8,
    description: 'Add crew_feedback table for crew training feedback',
    run: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS crew_feedback (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            crew_id     TEXT NOT NULL,
            positive    INTEGER NOT NULL,
            comment     TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_crew_feedback_crew ON crew_feedback(crew_id);
      `);
    },
  },
  {
    version: 9,
    description: 'Add mode column to sessions table for plan/agent mode persistence',
    run: (db: any) => {
      try { db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'plan'`); } catch { /* column may already exist */ }
    },
  },
  {
    version: 10,
    description: 'Add parent_id column to sessions for child session model',
    run: (db: any) => {
      try { db.exec(`ALTER TABLE sessions ADD COLUMN parent_id TEXT REFERENCES sessions(id)`); } catch { /* column may already exist */ }
    },
  },
  {
    version: 11,
    description: 'Add hyperdrive column to sessions for persisting hyperdrive state',
    run: (db: any) => {
      try { db.exec(`ALTER TABLE sessions ADD COLUMN hyperdrive INTEGER NOT NULL DEFAULT 0`); } catch { /* column may already exist */ }
    },
  },
  {
    version: 12,
    description: 'Add checkpoints table for DB-backed session snapshots',
    run: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS checkpoints (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL,
          label       TEXT NOT NULL,
          messages    TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
      `);
    },
  },
  {
    version: 13,
    description: 'Add metadata column to crews table for flexible crew field storage',
    run: (db: any) => {
      try { db.exec(`ALTER TABLE crews ADD COLUMN metadata TEXT`); } catch { /* column may already exist */ }
    },
  },
  {
    version: 14,
    description: 'Add agent_persona table for user-defined Agent-X persona config',
    run: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_persona (
          id      TEXT PRIMARY KEY,
          name    TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          communication_style TEXT NOT NULL DEFAULT 'direct',
          decision_making     TEXT NOT NULL DEFAULT 'balanced',
          domain_context      TEXT NOT NULL DEFAULT '',
          traits  TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 15,
    description: 'Add parts column to messages table for chronological tool ordering on restore',
    run: (db: any) => {
      try { db.exec(`ALTER TABLE messages ADD COLUMN parts TEXT`); } catch { /* column may already exist */ }
    },
  },
];

export class SessionStore {
  // If BetterSqlite3 is unavailable we operate in in-memory fallback mode.
  private db: any | null = null;
  private memMode = false;
  private memSessions: Map<string, Record<string, unknown>> = new Map();
  private memMessages: Map<string, Array<Record<string, unknown>>> = new Map();
  private memTokenLogs: Map<string, Array<Record<string, unknown>>> = new Map();
  private memPermissions: Map<string, Array<Record<string, unknown>>> = new Map();
  private memCrewStates: Map<string, Record<string, unknown>> = new Map();
  private memToolExecutions: Map<string, Array<Record<string, unknown>>> = new Map();
  private memSessionEvents: Map<string, Array<SessionEvent>> = new Map();
  private memPermissionRules: Map<string, Array<Record<string, unknown>>> = new Map();
  private memCrewFeedback: Map<string, Array<Record<string, unknown>>> = new Map();
  private memCheckpoints: Map<string, Array<Record<string, unknown>>> = new Map();
  private memPersona: Record<string, unknown> | null = null;
  private sessionsDir: string | null = null;
  private filesystemRecovered = 0;

  constructor(dbPath?: string) {
    const path = dbPath ?? getDbPath();
    mkdirSync(dirname(path), { recursive: true });

    if (!BetterSqlite3) {
      getLogger().warn('STORE', 'better-sqlite3 module not available. Falling back to in-memory mode.');
      this.memMode = true;
      this.db = null;
    } else {
      try {
        this.db = new BetterSqlite3(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.initialize();
      } catch (e) {
        getLogger().warn('STORE', `better-sqlite3 failed to open DB at ${path}: ${e instanceof Error ? e.message : e}. Falling back to in-memory mode.`);
        this.memMode = true;
        this.db = null;
      }
    }

    if (this.memMode && this.sessionsDir) {
      this.loadFromFilesystem();
    }
  }

  private initialize(): void {
    if (this.memMode || !this.db) return;
    this.db.exec(SCHEMA_SQL);

    // Schema versioning: get current version and run pending migrations
    try {
      const row = this.db.prepare('SELECT COALESCE(MAX(version), 0) as v FROM _schema').get() as { v: number } | undefined;
      const currentVersion = row?.v ?? 0;

      if (currentVersion < CURRENT_SCHEMA_VERSION) {
        getLogger().info('SCHEMA', `DB schema at version ${currentVersion}, target ${CURRENT_SCHEMA_VERSION}. Running migrations...`);
        for (const m of MIGRATIONS) {
          if (m.version > currentVersion && m.version <= CURRENT_SCHEMA_VERSION) {
            try {
              m.run(this.db);
              this.db.prepare('INSERT INTO _schema (version) VALUES (?)').run(m.version);
              getLogger().info('SCHEMA', `Migration v${m.version} applied: ${m.description}`);
            } catch (e) {
              getLogger().warn('SCHEMA', `Migration v${m.version} failed (non-fatal): ${e instanceof Error ? e.message : e}`);
            }
          }
        }
        getLogger().info('SCHEMA', `Schema updated to v${CURRENT_SCHEMA_VERSION}`);
      }
    } catch (e) {
      getLogger().warn('SCHEMA', `Schema version check failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Scan the filesystem sessions directory and import any sessions that exist on disk
   * but have no DB record (e.g. after DB migration, Docker→native switch, or crash).
   */
  recoverOrphanedSessions(sessionsDir: string): number {
    if (this.memMode) {
      this.sessionsDir = sessionsDir;
      return this.loadFromFilesystem();
    }
    if (!this.db || !existsSync(sessionsDir)) return 0;

    let recovered = 0;
    try {
      const entries = readdirSync(sessionsDir, { withFileTypes: true });

      const existingIds = new Set(
        (this.db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>).map(r => r.id)
      );

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (existingIds.has(entry.name)) continue;

        const sessionDir = join(sessionsDir, entry.name);
        const convPath = join(sessionDir, 'conversation.json');

        if (!existsSync(convPath)) continue;

        try {
          const convRaw = readFileSync(convPath, 'utf-8');
          const messages = JSON.parse(convRaw) as Array<{ role: string; content: string }>;
          const firstUserMsg = messages.find(m => m.role === 'user');
          const title = firstUserMsg?.content?.slice(0, 80) ?? 'Recovered session';

          let scopePath = '';
          const ctxPath = join(sessionDir, 'context.json');
          if (existsSync(ctxPath)) {
            try {
              const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
              if (ctx.__scopePath__) scopePath = ctx.__scopePath__ as string;
              else if (ctx.scopePath) scopePath = ctx.scopePath as string;
            } catch { /* ignore */ }
          }
          if (!scopePath) continue;

          const now = new Date().toISOString();

          this.db.prepare(`
            INSERT INTO sessions (id, title, status, provider_id, model_id, token_used, token_available, scope_path, mode, created_at, updated_at)
            VALUES (?, ?, 'active', '', '', 0, 128000, ?, 'plan', ?, ?)
          `).run(entry.name, title, scopePath, now, now);

          recovered++;
        } catch {
          // Skip sessions that can't be read
        }
      }
    } catch {
      // Best-effort recovery
    }
    return recovered;
  }

  getDb(): unknown {
    return this.db;
  }

  setSessionsDir(dir: string): void {
    this.sessionsDir = dir;
  }

  getInfo(): { dbMode: string; sessionCount: number; filesystemRecovered: number; schemaVersion: number } {
    let sessionCount: number;
    if (this.memMode) {
      sessionCount = this.memSessions.size;
    } else if (this.db) {
      try {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
        sessionCount = row?.count ?? 0;
      } catch {
        sessionCount = 0;
      }
    } else {
      sessionCount = 0;
    }
    return {
      dbMode: this.memMode ? 'memory' : 'sqlite',
      sessionCount,
      filesystemRecovered: this.filesystemRecovered,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * Load sessions from the filesystem sessions directory into the in-memory store.
   * This provides data continuity when the SQLite DB is unavailable.
   * Scans each session's conversation.json, context.json, etc.
   */
  loadFromFilesystem(): number {
    if (!this.sessionsDir || !existsSync(this.sessionsDir)) return 0;
    let loaded = 0;
    try {
      const entries = readdirSync(this.sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionDir = join(this.sessionsDir, entry.name);
        const convPath = join(sessionDir, 'conversation.json');
        if (!existsSync(convPath)) continue;
        try {
          const convRaw = readFileSync(convPath, 'utf-8');
          const messages = JSON.parse(convRaw) as Array<{ role: string; content: string }>;
          const firstUserMsg = messages.find(m => m.role === 'user');
          const title = firstUserMsg?.content?.slice(0, 80) ?? 'Recovered session';

          let scopePath = '';
          const ctxPath = join(sessionDir, 'context.json');
          if (existsSync(ctxPath)) {
            try {
              const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
              if (ctx.__scopePath__) scopePath = ctx.__scopePath__ as string;
              else if (ctx.scopePath) scopePath = ctx.scopePath as string;
            } catch { /* ignore */ }
          }
          if (!scopePath) {
            scopePath = '';
          }

          const now = new Date().toISOString();
          const msgCount = messages.length;

          this.memSessions.set(entry.name, {
            id: entry.name,
            title,
            status: 'active',
            provider: '',
            model: '',
            tokensUsed: 0,
            tokenAvailable: 128000,
            scopePath,
            mode: 'plan',
            createdAt: now,
            updatedAt: now,
            messageCount: msgCount,
          });

          this.memMessages.set(entry.name, messages.map((m, i) => ({
            id: `${m.role}-${i}-${entry.name}`,
            session_id: entry.name,
            role: m.role,
            content: m.content,
            token_count: 0,
            tool_calls: null,
            created_at: now,
          })));

          loaded++;
        } catch { /* skip sessions that can't be read */ }
      }
      this.filesystemRecovered = loaded;
      getLogger().info('STORE', `Loaded ${loaded} session(s) from filesystem into in-memory store`);
    } catch { /* best-effort */ }
    return loaded;
  }

  createSession(session: {
    id: string;
    title: string;
    status: string;
    provider: string;
    model: string;
    parentId?: string | null;
    tokensUsed?: number;
    tokenAvailable?: number;
    scopePath?: string;
    mode?: string;
    hyperdrive?: boolean;
    createdAt: string;
    updatedAt: string;
  }): void {
    if (this.memMode) {
      this.memSessions.set(session.id, {
        id: session.id,
        title: session.title,
        status: session.status,
        provider: session.provider,
        model: session.model,
        parentId: session.parentId ?? null,
        tokensUsed: session.tokensUsed ?? 0,
        tokenAvailable: session.tokenAvailable ?? 128000,
        scopePath: session.scopePath!,
        mode: session.mode ?? 'plan',
        hyperdrive: session.hyperdrive ? 1 : 0,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, title, status, provider_id, model_id, parent_id, token_used, token_available, scope_path, mode, hyperdrive, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.title,
      session.status,
      session.provider,
      session.model,
      session.parentId ?? null,
      session.tokensUsed ?? 0,
      session.tokenAvailable ?? 128000,
      session.scopePath ?? process.cwd(),
      session.mode ?? 'plan',
      session.hyperdrive ? 1 : 0,
      session.createdAt,
      session.updatedAt,
    );
  }

  getSession(sessionId: string): Record<string, unknown> | null {
    if (this.memMode) {
      const s = this.memSessions.get(sessionId);
      return s ?? null;
    }

    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row['id'],
      title: row['title'],
      status: row['status'],
      provider: row['provider_id'],
      model: row['model_id'],
      parentId: row['parent_id'] ?? null,
      tokensUsed: row['token_used'],
      scopePath: row['scope_path'],
      mode: row['mode'] ?? 'plan',
      hyperdrive: !!row['hyperdrive'],
      createdAt: row['created_at'],
      updatedAt: row['updated_at'],
    };
  }

  updateSession(sessionId: string, updates: Record<string, unknown>): void {
    if (this.memMode) {
      const s = this.memSessions.get(sessionId);
      if (!s) return;
      for (const [k, v] of Object.entries(updates)) {
        if (k === 'updatedAt') s.updatedAt = v as string;
        else s[k] = v as unknown;
      }
      this.memSessions.set(sessionId, s);
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    const columnMap: Record<string, string> = {
      title: 'title',
      status: 'status',
      provider: 'provider_id',
      model: 'model_id',
      mode: 'mode',
      hyperdrive: 'hyperdrive',
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
    if (this.memMode) {
      const all = Array.from(this.memSessions.values());
      // sort by updatedAt desc if present
      all.sort((a: any, b: any) => {
        const ta = a.updatedAt ?? '';
        const tb = b.updatedAt ?? '';
        return tb.localeCompare(ta);
      });
      return all.slice(0, limit) as Array<Record<string, unknown>>;
    }

    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?');
    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row['id'],
      title: row['title'],
      status: row['status'],
      provider: row['provider_id'],
      model: row['model_id'],
      parentId: row['parent_id'] ?? null,
      tokensUsed: row['token_used'],
      scopePath: row['scope_path'],
      mode: row['mode'] ?? 'plan',
      hyperdrive: !!row['hyperdrive'],
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
    if (this.memMode) {
      const arr = this.memMessages.get(message.sessionId) ?? [];
      arr.push({
        id: message.id,
        session_id: message.sessionId,
        role: message.role,
        content: message.content,
        token_count: message.tokenCount ?? 0,
        tool_calls: message.toolCalls ?? null,
        created_at: message.createdAt,
      });
      this.memMessages.set(message.sessionId, arr);
      return;
    }

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
    if (this.memMode) {
      return (this.memMessages.get(sessionId) ?? []) as Array<Record<string, unknown>>;
    }

    const stmt = this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
    const rows = stmt.all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      parts: row['parts'] ? (() => { try { return JSON.parse(row['parts'] as string); } catch { return undefined; } })() : undefined,
      metadata: row['metadata'] ? JSON.parse(row['metadata'] as string) : undefined,
    }));
  }

  insertMessage(msg: {
    sessionId: string;
    role: string;
    content: string;
    toolCalls?: unknown;
    tokenCount?: number;
    crew?: unknown;
    thinking?: string;
    plan?: string;
    parts?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }): void {
    if (this.memMode) {
      const msgs = this.memMessages.get(msg.sessionId) ?? [];
      msgs.push({ ...msg, id: crypto.randomUUID(), created_at: new Date().toISOString() });
      this.memMessages.set(msg.sessionId, msgs);
      return;
    }
    try {
      this.db!.prepare(`
        INSERT INTO messages (id, session_id, role, content, tool_calls, token_count, plan, parts, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        crypto.randomUUID(),
        msg.sessionId,
        msg.role,
        msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.tokenCount ?? 0,
        msg.plan || null,
        msg.parts ? JSON.stringify(msg.parts) : null,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
      );
    } catch (e) {
      getLogger().warn('STORE', `insertMessage failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  insertPart(sessionId: string, part: {
    type: string;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    toolSuccess?: boolean;
    usage?: { inputTokens: number; outputTokens: number };
  }): void {
    if (this.memMode) {
      const msgs = this.memMessages.get(sessionId) ?? [];
      msgs.push({ ...part, id: crypto.randomUUID(), session_id: sessionId, role: 'part', created_at: new Date().toISOString() });
      this.memMessages.set(sessionId, msgs);
      return;
    }
    try {
      this.db!.prepare(`
        INSERT INTO message_parts (id, session_id, type, content, tool_name, tool_call_id, tool_args, tool_result, tool_success, usage_input, usage_output)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        sessionId,
        part.type,
        part.content || null,
        part.toolName || null,
        part.toolCallId || null,
        part.toolArgs ? JSON.stringify(part.toolArgs) : null,
        part.toolResult || null,
        part.toolSuccess != null ? (part.toolSuccess ? 1 : 0) : null,
        part.usage?.inputTokens || null,
        part.usage?.outputTokens || null,
      );
    } catch (e) {
      getLogger().warn('STORE', `insertPart failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  getParts(sessionId: string): Array<Record<string, unknown>> {
    if (this.memMode) {
      const msgs = this.memMessages.get(sessionId) ?? [];
      return msgs.filter(m => (m as any).role === 'part');
    }
    try {
      return this.db!.prepare('SELECT * FROM message_parts WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Array<Record<string, unknown>>;
    } catch { return []; }
  }

  deleteMessages(sessionId: string): void {
    if (this.memMode) {
      this.memMessages.set(sessionId, []);
      return;
    }

    const stmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    stmt.run(sessionId);
    this.db.prepare('DELETE FROM message_parts WHERE session_id = ?').run(sessionId);
  }

  /**
   * Delete the last N messages with specified roles (user, assistant).
   * Used for retry logic to remove the last exchange without touching whole session.
   */
  deleteLastMessages(sessionId: string, count: number, roles: string[]): void {
    if (this.memMode) {
      const msgs = this.memMessages.get(sessionId) ?? [];
      let removed = 0;
      for (let i = msgs.length - 1; i >= 0 && removed < count; i--) {
        if (roles.includes(msgs[i]?.role as string)) {
          msgs.splice(i, 1);
          removed++;
        }
      }
      this.memMessages.set(sessionId, msgs);
      return;
    }

    const stmt = this.db.prepare(
      `DELETE FROM messages WHERE id IN (
        SELECT id FROM messages
        WHERE session_id = ? AND role IN (${roles.map(() => '?').join(',')})
        ORDER BY created_at DESC
        LIMIT ?
      )`,
    );
    stmt.run(sessionId, ...roles, count);
  }

  getMessageCount(sessionId: string): number {
    if (this.memMode) {
      return (this.memMessages.get(sessionId) ?? []).length;
    }

    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?');
    const row = stmt.get(sessionId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  createCheckpoint(sessionId: string, label: string): { id: string } | null {
    const msgs = this.getMessages(sessionId);
    if (!msgs || msgs.length === 0) return null;
    const id = crypto.randomUUID();
    const messagesJson = JSON.stringify(msgs);

    if (this.memMode) {
      const arr = this.memCheckpoints.get(sessionId) ?? [];
      arr.push({ id, session_id: sessionId, label, messages: messagesJson, created_at: new Date().toISOString() });
      this.memCheckpoints.set(sessionId, arr);
      return { id };
    }

    // Keep only 20 most recent checkpoints per session
    this.db.prepare(`
      DELETE FROM checkpoints WHERE id IN (
        SELECT id FROM checkpoints WHERE session_id = ?
        ORDER BY created_at ASC
        LIMIT MAX(0, (SELECT COUNT(*) FROM checkpoints WHERE session_id = ?) - 19)
      )
    `).run(sessionId, sessionId);

    this.db.prepare(`
      INSERT INTO checkpoints (id, session_id, label, messages, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(id, sessionId, label, messagesJson);
    return { id };
  }

  listCheckpoints(sessionId: string): Array<{ id: string; label: string; createdAt: string; messageCount: number }> {
    if (this.memMode) {
      const arr = this.memCheckpoints.get(sessionId) ?? [];
      return arr.map((c: any) => ({ id: c.id, label: c.label, createdAt: c.created_at, messageCount: JSON.parse(c.messages as string).length }));
    }

    const rows = this.db.prepare('SELECT id, label, messages, created_at FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: r['id'] as string, label: r['label'] as string, createdAt: r['created_at'] as string, messageCount: JSON.parse(r['messages'] as string).length }));
  }

  getCheckpoint(sessionId: string, checkpointId: string): Array<Record<string, unknown>> | null {
    if (this.memMode) {
      const arr = this.memCheckpoints.get(sessionId) ?? [];
      const c = arr.find((c: any) => c.id === checkpointId);
      if (!c) return null;
      return JSON.parse(c.messages as string);
    }

    const row = this.db.prepare('SELECT messages FROM checkpoints WHERE id = ? AND session_id = ?').get(checkpointId, sessionId) as { messages: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.messages);
  }

  restoreCheckpoint(sessionId: string, checkpointId: string): boolean {
    const msgs = this.getCheckpoint(sessionId, checkpointId);
    if (!msgs) return false;

    // Clear existing messages
    this.deleteMessages(sessionId);

    // Restore checkpoint messages
    for (const msg of msgs) {
      if (msg['role'] === 'part') continue;
      this.insertMessage({
        sessionId,
        role: msg['role'] as string || 'system',
        content: msg['content'] as string || '',
        toolCalls: msg['tool_calls'] || undefined,
        tokenCount: msg['token_count'] as number || undefined,
      });
    }
    return true;
  }

  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    if (this.memMode) {
      const arr = this.memCheckpoints.get(sessionId) ?? [];
      const idx = arr.findIndex((c: any) => c.id === checkpointId);
      if (idx === -1) return false;
      arr.splice(idx, 1);
      return true;
    }

    const result = this.db.prepare('DELETE FROM checkpoints WHERE id = ? AND session_id = ?').run(checkpointId, sessionId);
    return result.changes > 0;
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
    crewId?: string;
  }): void {
    if (this.memMode) {
      const arr = this.memTokenLogs.get(log.sessionId) ?? [];
      arr.push({
        id: log.id,
        session_id: log.sessionId,
        message_id: log.messageId ?? null,
        provider_id: log.providerId,
        model_id: log.modelId,
        input_tokens: log.inputTokens,
        output_tokens: log.outputTokens,
        reasoning_tokens: log.reasoningTokens ?? 0,
        cost_usd: log.costUsd ?? null,
        crew_id: log.crewId ?? null,
      });
      this.memTokenLogs.set(log.sessionId, arr);
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO token_logs (id, session_id, message_id, provider_id, model_id, input_tokens, output_tokens, reasoning_tokens, cost_usd, crew_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      log.crewId ?? null,
    );
  }

  getTokenLogs(sessionId: string): Array<Record<string, unknown>> {
    if (this.memMode) {
      return (this.memTokenLogs.get(sessionId) ?? []) as Array<Record<string, unknown>>;
    }

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
    if (this.memMode) {
      // Store tool executions in memory for audit/debug even in memory mode
      const arr = (this.memToolExecutions.get(exec.sessionId) ?? []) as Array<Record<string, unknown>>;
      arr.push({
        id: exec.id,
        sessionId: exec.sessionId,
        agentTaskId: exec.agentTaskId ?? null,
        toolName: exec.toolName,
        input: exec.input,
        output: exec.output ?? null,
        success: exec.success ?? null,
        elapsedMs: exec.elapsedMs ?? null,
      });
      this.memToolExecutions.set(exec.sessionId, arr);
      return;
    }

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
    if (this.memMode) {
      const arr = this.memPermissions.get(perm.sessionId) ?? [];
      arr.push({ id: perm.id, session_id: perm.sessionId, tool_name: perm.toolName, target_path: perm.targetPath ?? null, decision: perm.decision });
      this.memPermissions.set(perm.sessionId, arr);
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO permissions (id, session_id, tool_name, target_path, decision)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(perm.id, perm.sessionId, perm.toolName, perm.targetPath ?? null, perm.decision);
  }

  getPermissions(sessionId: string): Array<Record<string, unknown>> {
    if (this.memMode) {
      return (this.memPermissions.get(sessionId) ?? []) as Array<Record<string, unknown>>;
    }

    const stmt = this.db.prepare('SELECT * FROM permissions WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId) as Array<Record<string, unknown>>;
  }

  addPermissionRule(rule: {
    id: string;
    sessionId: string;
    action: string;
    pattern?: string;
    effect: string;
    comment?: string;
  }): void {
    if (this.memMode) {
      const arr = this.memPermissionRules.get(rule.sessionId) ?? [];
      arr.push({
        id: rule.id,
        session_id: rule.sessionId,
        action: rule.action,
        pattern: rule.pattern ?? '*',
        effect: rule.effect,
        comment: rule.comment ?? null,
      });
      this.memPermissionRules.set(rule.sessionId, arr);
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO permission_rules (id, session_id, action, pattern, effect, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(rule.id, rule.sessionId, rule.action, rule.pattern ?? '*', rule.effect, rule.comment ?? null);
  }

  getPermissionRules(sessionId: string): Array<Record<string, unknown>> {
    if (this.memMode) {
      return (this.memPermissionRules.get(sessionId) ?? []) as Array<Record<string, unknown>>;
    }

    const stmt = this.db.prepare('SELECT * FROM permission_rules WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId) as Array<Record<string, unknown>>;
  }

  clearPermissionRules(sessionId: string): void {
    if (this.memMode) {
      this.memPermissionRules.set(sessionId, []);
      return;
    }

    this.db.prepare('DELETE FROM permission_rules WHERE session_id = ?').run(sessionId);
  }

  saveCrewState(state: {
    id: string;
    sessionId: string;
    crewId: string;
    enabled: boolean;
    lastActive?: string;
    messageCount?: number;
  }): void {
    if (this.memMode) {
      // Memory mode: store in a simple map
      const key = `${state.sessionId}:${state.crewId}`;
      if (!this.memCrewStates) this.memCrewStates = new Map();
      this.memCrewStates.set(key, {
        id: state.id,
        session_id: state.sessionId,
        crew_id: state.crewId,
        enabled: state.enabled ? 1 : 0,
        last_active: state.lastActive ?? null,
        message_count: state.messageCount ?? 0,
      });
      return;
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_crew_states (id, session_id, crew_id, enabled, last_active, message_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      state.id,
      state.sessionId,
      state.crewId,
      state.enabled ? 1 : 0,
      state.lastActive ?? null,
      state.messageCount ?? 0,
    );
  }

  getCrewStates(sessionId: string): Array<Record<string, unknown>> {
    if (this.memMode) {
      if (!this.memCrewStates) return [];
      const results: Array<Record<string, unknown>> = [];
      for (const [key, value] of this.memCrewStates.entries()) {
        if (key.startsWith(`${sessionId}:`)) {
          results.push(value);
        }
      }
      return results;
    }

    const stmt = this.db.prepare('SELECT * FROM session_crew_states WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId) as Array<Record<string, unknown>>;
  }

  addCrewFeedback(feedback: {
    id: string;
    sessionId: string;
    crewId: string;
    positive: boolean;
    comment?: string | null;
    createdAt: string;
  }): void {
    if (this.memMode) {
      const arr = this.memCrewFeedback.get(feedback.crewId) ?? [];
      arr.push({
        id: feedback.id,
        session_id: feedback.sessionId,
        crew_id: feedback.crewId,
        positive: feedback.positive ? 1 : 0,
        comment: feedback.comment ?? null,
        created_at: feedback.createdAt,
      });
      this.memCrewFeedback.set(feedback.crewId, arr);
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO crew_feedback (id, session_id, crew_id, positive, comment)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      feedback.id,
      feedback.sessionId,
      feedback.crewId,
      feedback.positive ? 1 : 0,
      feedback.comment ?? null,
    );
  }

  getCrewFeedback(crewId: string): Array<Record<string, unknown>> {
    if (this.memMode) {
      return (this.memCrewFeedback.get(crewId) ?? []) as Array<Record<string, unknown>>;
    }

    const stmt = this.db.prepare('SELECT * FROM crew_feedback WHERE crew_id = ? ORDER BY created_at DESC');
    return stmt.all(crewId) as Array<Record<string, unknown>>;
  }

  deleteSession(sessionId: string): void {
    if (this.memMode) {
      this.memSessions.delete(sessionId);
      this.memMessages.delete(sessionId);
      this.memTokenLogs.delete(sessionId);
      this.memPermissions.delete(sessionId);
      this.memSessionEvents.delete(sessionId);
      this.memPermissionRules.delete(sessionId);
      if (this.memCrewStates) {
        for (const key of this.memCrewStates.keys()) {
          if (key.startsWith(`${sessionId}:`)) {
            this.memCrewStates.delete(key);
          }
        }
      }
      return;
    }

    try { this.db.prepare('DELETE FROM session_events WHERE session_id = ?').run(sessionId); } catch { /* table may not exist yet */ }
    try { this.db.prepare('DELETE FROM crew_feedback WHERE session_id = ?').run(sessionId); } catch { /* table may not exist yet */ }
    try { this.db.prepare('DELETE FROM permission_rules WHERE session_id = ?').run(sessionId); } catch { /* table may not exist yet */ }
    this.db.prepare('DELETE FROM session_crew_states WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM tool_executions WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM token_logs WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM permissions WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM permission_rules WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM agent_tasks WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM message_parts WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  getPersona(): { name: string; description: string; communicationStyle: string; decisionMaking: string; domainContext: string; traits: string[] } | null {
    if (this.memMode) {
      return this.memPersona as any ?? null;
    }
    try {
      const row = this.db!.prepare('SELECT * FROM agent_persona WHERE id = ?').get('00000000-0000-0000-0000-000000000001') as any;
      if (!row) return null;
      return {
        name: row.name,
        description: row.description,
        communicationStyle: row.communication_style,
        decisionMaking: row.decision_making,
        domainContext: row.domain_context,
        traits: JSON.parse(row.traits || '[]'),
      };
    } catch {
      return null;
    }
  }

  setPersona(persona: { name: string; description: string; communicationStyle: string; decisionMaking: string; domainContext: string; traits: string[] }): void {
    if (this.memMode) {
      this.memPersona = persona as any;
      return;
    }
    try {
      this.db!.prepare(`
        INSERT INTO agent_persona (id, name, description, communication_style, decision_making, domain_context, traits, updated_at)
        VALUES ('00000000-0000-0000-0000-000000000001', ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          communication_style = excluded.communication_style,
          decision_making = excluded.decision_making,
          domain_context = excluded.domain_context,
          traits = excluded.traits,
          updated_at = datetime('now')
      `).run(persona.name, persona.description, persona.communicationStyle, persona.decisionMaking, persona.domainContext, JSON.stringify(persona.traits));
    } catch { /* table may not exist yet */ }
  }

  clearAll(): void {
    if (this.memMode) {
      this.memSessions.clear();
      this.memMessages.clear();
      this.memTokenLogs.clear();
      this.memPermissions.clear();
      this.memPermissionRules.clear();
      this.memSessionEvents.clear();
      this.memPersona = null;
      if (this.memCrewStates) this.memCrewStates.clear();
      return;
    }
    try { this.db.exec('DELETE FROM session_events'); } catch { /* table may not exist yet */ }
    try { this.db.exec('DELETE FROM crew_feedback'); } catch { /* table may not exist yet */ }
    try { this.db.exec('DELETE FROM permission_rules'); } catch { /* table may not exist yet */ }
    this.db.exec('DELETE FROM session_crew_states');
    this.db.exec('DELETE FROM tool_executions');
    this.db.exec('DELETE FROM token_logs');
    this.db.exec('DELETE FROM permissions');
    this.db.exec('DELETE FROM permission_rules');
    this.db.exec('DELETE FROM agent_tasks');
    this.db.exec('DELETE FROM messages');
    this.db.exec('DELETE FROM message_parts');
    this.db.exec('DELETE FROM sessions');
  }

  insertSessionEvent(event: SessionEvent): void {
    if (this.memMode) {
      const arr = this.memSessionEvents.get(event.sessionId) ?? [];
      arr.push(event);
      this.memSessionEvents.set(event.sessionId, arr);
      return;
    }
    try {
      this.db!.prepare(`
        INSERT INTO session_events (id, session_id, sequence, event_type, payload)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        event.sessionId,
        event.sequence,
        event.type,
        JSON.stringify(event),
      );
    } catch (e) {
      getLogger().warn('STORE', `insertSessionEvent failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  getSessionEvents(sessionId: string, sinceSequence?: number): SessionEvent[] {
    if (this.memMode) {
      const all = (this.memSessionEvents.get(sessionId) ?? []) as SessionEvent[];
      return sinceSequence != null ? all.filter(e => e.sequence > sinceSequence!) : [...all];
    }
    try {
      let rows: Record<string, unknown>[];
      if (sinceSequence != null) {
        rows = this.db!.prepare('SELECT * FROM session_events WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC').all(sessionId, sinceSequence) as Record<string, unknown>[];
      } else {
        rows = this.db!.prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY sequence ASC').all(sessionId) as Record<string, unknown>[];
      }
      return rows.map(row => JSON.parse(row['payload'] as string) as SessionEvent);
    } catch { return []; }
  }

  *replayEvents(sessionId: string, sinceSequence?: number): Generator<SessionEvent, void, undefined> {
    const events = this.getSessionEvents(sessionId, sinceSequence);
    for (const event of events) {
      yield event;
    }
  }

  // ─── Crew CRUD ──────────────────────────────────────────────────────

  private crewFromRow(row: Record<string, unknown>): Crew {
    const metadata = row['metadata'] ? JSON.parse(row['metadata'] as string) as Partial<Crew> : {};
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      title: (row['title'] as string) || metadata.title,
      callsign: metadata.callsign ?? (row['id'] as string),
      systemPrompt: row['system_prompt'] as string ?? metadata.systemPrompt ?? '',
      description: row['description'] as string || metadata.description || '',
      emotion: metadata.emotion,
      isDefault: !!(row['is_default'] ?? metadata.isDefault),
      enabled: metadata.enabled ?? true,
      expertise: metadata.expertise ?? (row['expertise'] ? (row['expertise'] as string).split(',') : undefined),
      traits: metadata.traits ?? (row['traits'] ? (row['traits'] as string).split(',') : undefined),
      toolPreferences: metadata.toolPreferences,
      tools: metadata.tools,
      permissions: metadata.permissions,
      model: metadata.model,
      protocol: metadata.protocol,
      quotas: metadata.quotas,
      color: metadata.color,
      icon: metadata.icon,
      createdAt: row['created_at'] as string ?? metadata.createdAt ?? new Date().toISOString(),
      updatedAt: row['updated_at'] as string ?? metadata.updatedAt ?? new Date().toISOString(),
    };
  }

  listCrews(): Crew[] {
    if (this.memMode) return [];
    if (!this.db) return [];
    try {
      const rows = this.db.prepare('SELECT * FROM crews ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
      return rows.map(row => this.crewFromRow(row));
    } catch (e) {
      getLogger().warn('STORE', `listCrews failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  getCrew(id: string): Crew | undefined {
    if (this.memMode || !this.db) return undefined;
    try {
      const row = this.db.prepare('SELECT * FROM crews WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? this.crewFromRow(row) : undefined;
    } catch { return undefined; }
  }

  createCrew(input: CrewCreateInput): Crew {
    const now = new Date().toISOString();
    const crew: Crew = {
      id: input.id,
      name: input.name,
      title: input.title,
      callsign: input.callsign || input.name.replace(/\s+/g, '').toLowerCase(),
      systemPrompt: input.systemPrompt ?? '',
      emotion: input.emotion,
      isDefault: input.isDefault ?? false,
      enabled: input.enabled ?? true,
      expertise: input.expertise,
      traits: input.traits,
      toolPreferences: input.toolPreferences,
      tools: input.tools,
      permissions: input.permissions,
      model: input.model,
      protocol: input.protocol,
      quotas: input.quotas,
      color: input.color,
      icon: input.icon,
      createdAt: now,
      updatedAt: now,
    };
    if (this.memMode || !this.db) return crew;
    try {
      this.db.prepare(`
        INSERT INTO crews (id, name, title, description, system_prompt, expertise, traits, tool_preferences, enabled_tools, disabled_tools, is_default, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crew.id,
        crew.name,
        crew.title || null,
        crew.description || '',
        crew.systemPrompt,
        crew.expertise?.join(',') ?? null,
        crew.traits?.join(',') ?? null,
        crew.toolPreferences?.enabled?.join(',') ?? null,
        crew.toolPreferences?.enabled?.join(',') ?? null,
        crew.toolPreferences?.disabled?.join(',') ?? null,
        crew.isDefault ? 1 : 0,
        JSON.stringify(crew),
        now,
        now,
      );
    } catch (e) {
      getLogger().warn('STORE', `createCrew failed: ${e instanceof Error ? e.message : e}`);
    }
    return crew;
  }

  updateCrew(id: string, updates: Partial<Crew>): Crew | null {
    if (this.memMode || !this.db) return null;
    try {
      const existing = this.db.prepare('SELECT * FROM crews WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!existing) return null;
      const crew = this.crewFromRow(existing);
      Object.assign(crew, updates, { id: crew.id, createdAt: crew.createdAt });
      crew.updatedAt = new Date().toISOString();
      this.db.prepare(`
        UPDATE crews SET name=?, title=?, description=?, system_prompt=?, expertise=?, traits=?, tool_preferences=?, enabled_tools=?, disabled_tools=?, is_default=?, metadata=?, updated_at=?
        WHERE id=?
      `).run(
        crew.name,
        crew.title || null,
        crew.description || '',
        crew.systemPrompt,
        crew.expertise?.join(',') ?? null,
        crew.traits?.join(',') ?? null,
        crew.toolPreferences?.enabled?.join(',') ?? null,
        crew.toolPreferences?.enabled?.join(',') ?? null,
        crew.toolPreferences?.disabled?.join(',') ?? null,
        crew.isDefault ? 1 : 0,
        JSON.stringify(crew),
        crew.updatedAt,
        id,
      );
      return crew;
    } catch (e) {
      getLogger().warn('STORE', `updateCrew failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  deleteCrew(id: string): boolean {
    if (this.memMode || !this.db) return false;
    try {
      const result = this.db.prepare('DELETE FROM crews WHERE id = ?').run(id);
      return result.changes > 0;
    } catch { return false; }
  }

  getDefaultCrew(): Crew | undefined {
    if (this.memMode || !this.db) return undefined;
    try {
      const row = this.db.prepare('SELECT * FROM crews WHERE is_default = 1 LIMIT 1').get() as Record<string, unknown> | undefined;
      return row ? this.crewFromRow(row) : undefined;
    } catch { return undefined; }
  }

  close(): void {
    if (this.memMode) return;
    if (!this.db) return;
    
    // Checkpoint WAL to prevent data loss on close
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Non-critical, best effort
    }
    
    this.db.close();
  }
}
