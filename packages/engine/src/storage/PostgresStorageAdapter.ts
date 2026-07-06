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
import type { SessionEvent, Crew, CrewCreateInput } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { normalizeSessionUpdates } from '../session/session-field-utils.js';
import { estimateTokensFromMessages } from '../session/session-token-utils.js';
import { buildCrewSearchText } from '@agentx/shared';
import { purgeOrphanChildSessionsPg } from '../session/child-session-cleanup.js';
import {
  runPgCrewCatalogMigration,
  backfillPgCrewSearchColumns,
  createPgCrewCatalogStore,
} from '../crew/postgres-crew-catalog.js';
import type { CrewCatalogStore } from '../crew/CrewSuggestionService.js';
import { MemoryFabric } from '../neural/MemoryFabric.js';

const logger = getLogger();

const SCHEMA_SQL = `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Session',
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        scope_path TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'plan',
        parent_id TEXT REFERENCES sessions(id),
        hyperdrive BOOLEAN NOT NULL DEFAULT FALSE,
        token_used INTEGER DEFAULT 0,
        token_available INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

CREATE TABLE IF NOT EXISTS child_sessions (
  id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'sub_agent',
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_child_sessions_parent ON child_sessions(parent_session_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  plan TEXT,
  parts TEXT,
  metadata TEXT,
  token_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_parts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT,
  type TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  tool_args TEXT,
  tool_result TEXT,
  tool_success INTEGER,
  usage_input INTEGER,
  usage_output INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT,
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER DEFAULT 0,
  cost_usd REAL,
  crew_id TEXT,
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

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  messages TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_crew_states (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_active TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, crew_id)
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_task_id TEXT,
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  success INTEGER,
  elapsed_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permission_rules (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  pattern TEXT NOT NULL DEFAULT '*',
  effect TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id TEXT,
  instruction TEXT NOT NULL,
  tools TEXT,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  title TEXT,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  expertise TEXT,
  traits TEXT,
  tool_preferences TEXT,
  enabled_tools TEXT,
  disabled_tools TEXT,
  is_default INTEGER DEFAULT 0,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crew_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL,
  positive INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS turn_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  context_kind TEXT NOT NULL DEFAULT 'agent_x',
  crew_id TEXT,
  rating TEXT NOT NULL,
  turn_summary TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, message_id)
);

CREATE TABLE IF NOT EXISTS session_resume_state (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_parts_session ON message_parts(session_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_session ON token_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_permissions_session ON permissions(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_crew_feedback_crew ON crew_feedback(crew_id);
CREATE INDEX IF NOT EXISTS idx_turn_feedback_session ON turn_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_turn_feedback_crew ON turn_feedback(crew_id);
CREATE INDEX IF NOT EXISTS idx_session_crew_states_session ON session_crew_states(session_id);

CREATE TABLE IF NOT EXISTS bot_credentials (
  platform TEXT PRIMARY KEY,
  config_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  trigger_patterns_json TEXT NOT NULL DEFAULT '[]',
  prompt TEXT NOT NULL DEFAULT '',
  tools_json TEXT NOT NULL DEFAULT '[]',
  is_bundled INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_persona (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  communication_style TEXT NOT NULL DEFAULT 'direct',
  decision_making TEXT NOT NULL DEFAULT 'balanced',
  domain_context TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  goal TEXT NOT NULL DEFAULT '',
  plan_state TEXT NOT NULL DEFAULT '{}',
  failure_history TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_experiences (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  category TEXT,
  action TEXT,
  context TEXT,
  result TEXT,
  confidence REAL,
  reward REAL,
  correction TEXT,
  learnings TEXT,
  metadata TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_growth_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  level TEXT DEFAULT 'Fresh',
  wisdom_score REAL DEFAULT 0,
  total_experiences INTEGER DEFAULT 0,
  total_interactions INTEGER DEFAULT 0,
  total_corrections INTEGER DEFAULT 0,
  avg_confidence REAL DEFAULT 0.5,
  emotional_range REAL DEFAULT 0,
  capabilities TEXT DEFAULT '[]',
  next_milestone_at INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_emotions (
  id TEXT PRIMARY KEY,
  mood TEXT,
  intensity REAL,
  context TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  content TEXT,
  category TEXT,
  importance REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_diary (
  id TEXT PRIMARY KEY,
  entry TEXT,
  importance INTEGER,
  highlights TEXT,
  tags TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_identity (
  id INTEGER PRIMARY KEY DEFAULT 1,
  interaction_count INTEGER DEFAULT 0
);
`;

interface CacheState {
  sessions: Map<string, StorableSession>;
  childSessions: Map<string, Array<Record<string, unknown>>>;
  messages: Map<string, StorableMessage[]>;
  parts: Map<string, Array<Record<string, unknown>>>;
  crews: Crew[];
  persona: { name: string; description: string; communicationStyle: string; decisionMaking: string; domainContext: string; traits: string[] } | null;
  checkpoints: Map<string, Array<{ id: string; session_id: string; label: string; messages: string; created_at: string }>>;
  crewStates: Map<string, Array<Record<string, unknown>>>;
  sessionEvents: Map<string, SessionEvent[]>;
  tokenLogs: Map<string, StorableTokenLog[]>;
  permissions: Map<string, StorablePermission[]>;
  crewFeedback: Map<string, Array<Record<string, unknown>>>;
  turnFeedback: Map<string, Array<Record<string, unknown>>>;
  resumeState: Map<string, Record<string, unknown>>;
  permissionRules: Map<string, Array<Record<string, unknown>>>;
  taskSnapshots: Map<string, Record<string, unknown>>;
}

export interface PostgresConfig extends PoolConfig {
  autoMigrate?: boolean;
  /** When true (default), only load session metadata at connect; messages load on demand. */
  lazyHydrate?: boolean;
}

export class PostgresStorageAdapter implements StorageAdapter {
  private pool: Pool;
  private connected = false;
  private lazyHydrate: boolean;
  private hydratedSessions = new Set<string>();
  private cache: CacheState = { sessions: new Map(), childSessions: new Map(), messages: new Map(), parts: new Map(), crews: [], persona: null, checkpoints: new Map(), crewStates: new Map(), sessionEvents: new Map(), tokenLogs: new Map(), permissions: new Map(), crewFeedback: new Map(), turnFeedback: new Map(), resumeState: new Map(), permissionRules: new Map(), taskSnapshots: new Map() };

  constructor(config: PostgresConfig) {
    this.pool = new Pool(config);
    this.lazyHydrate = config.lazyHydrate !== false;
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

  private connectPromise: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();
      await this.migrate();
      await this.seedDefaultPersona();
      if (this.lazyHydrate) {
        await this.hydrateEssentialCache();
      } else {
        await this.hydrateCache();
      }
      this.connected = true;
      logger.info('PG_CONNECTED', 'PostgreSQL connection established');
    } catch (error) {
      this.connected = false;
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

  /** Expose the PG pool for neural engines and other subsystems. */
  getPool(): Pool {
    return this.pool;
  }

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
      await client.query(SCHEMA_SQL);
      // Incremental migrations for columns added after initial schema
      await client.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS parts TEXT');
      await client.query('ALTER TABLE message_parts ADD COLUMN IF NOT EXISTS message_id TEXT');
      await client.query('CREATE INDEX IF NOT EXISTS idx_message_parts_message_id ON message_parts(message_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_message_parts_session_created ON message_parts(session_id, created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at)');
      await client.query('ALTER TABLE crews ADD COLUMN IF NOT EXISTS title TEXT');
      await client.query('ALTER TABLE crews ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT \'\'');
      await client.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS compaction_count INTEGER NOT NULL DEFAULT 0');
      await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_kind TEXT NOT NULL DEFAULT 'agent_x'`);
      await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_id TEXT`);
      for (const col of [
        'host_crew_name',
        'host_crew_callsign',
        'host_crew_title',
        'host_crew_color',
        'host_crew_catalog_id',
        'host_crew_category_id',
      ]) {
        await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ${col} TEXT`);
      }
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_crew_private ON sessions(host_crew_id, context_kind)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS turn_feedback (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL,
          context_kind TEXT NOT NULL DEFAULT 'agent_x',
          crew_id TEXT,
          rating TEXT NOT NULL,
          turn_summary TEXT,
          metadata TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(session_id, message_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_turn_feedback_session ON turn_feedback(session_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_turn_feedback_crew ON turn_feedback(crew_id)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS session_resume_state (
          session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          message_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        INSERT INTO child_sessions (id, parent_session_id, kind, label, status, created_at, updated_at)
        SELECT id, parent_id, 'sub_agent', title, status, created_at, updated_at
        FROM sessions WHERE parent_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING
      `);
      await purgeOrphanChildSessionsPg(this.pool);
      await runPgCrewCatalogMigration(this.pool);
      await backfillPgCrewSearchColumns(this.pool, (row) => this.crewFromRow(row));
      await client.query(`
        CREATE TABLE IF NOT EXISTS automation_tasks (
          id TEXT PRIMARY KEY,
          task_key TEXT,
          title TEXT NOT NULL,
          instruction TEXT NOT NULL,
          schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'recurring')),
          cron_expression TEXT,
          run_at TIMESTAMPTZ,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          status TEXT NOT NULL DEFAULT 'active',
          source_channel TEXT NOT NULL DEFAULT 'web',
          source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          notify_channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
          permission_snapshot JSONB,
          pgboss_job_id TEXT,
          pgboss_schedule_name TEXT,
          last_run_at TIMESTAMPTZ,
          last_run_status TEXT,
          next_run_at TIMESTAMPTZ,
          run_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_automation_tasks_status ON automation_tasks(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_automation_tasks_session ON automation_tasks(source_session_id)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_tasks_active_key ON automation_tasks(task_key) WHERE task_key IS NOT NULL AND status = 'active'`);
      await client.query(`ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS display_id TEXT`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_tasks_display_id ON automation_tasks(display_id) WHERE display_id IS NOT NULL`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS automation_run_logs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          level TEXT NOT NULL,
          label TEXT NOT NULL,
          detail TEXT,
          event_type TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_automation_run_logs_task_created ON automation_run_logs(task_id, created_at)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_automation_run_logs_run ON automation_run_logs(run_id, created_at)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          task_id TEXT REFERENCES automation_tasks(id) ON DELETE SET NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          payload JSONB,
          channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
          delivery_status JSONB NOT NULL DEFAULT '{}'::jsonb,
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)`);
      await client.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL AND dismissed_at IS NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(created_at DESC) WHERE dismissed_at IS NULL`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS automation_session_confirmations (
          session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
          confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmation_note TEXT
        )
      `);
      await new MemoryFabric(this.pool).migrate();
    } finally {
      client.release();
    }
  }

  /** Idempotent schema repair — safe after manual table drops. */
  async repairSchema(): Promise<void> {
    await this.migrate();
  }

  /** Seed default persona if none exists. Idempotent. */
  async seedDefaultPersona(): Promise<{ created: boolean }> {
    const id = '00000000-0000-0000-0000-000000000001';
    const { rows } = await this.pool.query('SELECT 1 AS ok FROM agent_persona WHERE id = $1', [id]);
    if (rows.length > 0) return { created: false };
    await this.pool.query(
      `INSERT INTO agent_persona (id, name, description, communication_style, decision_making, domain_context, traits)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, 'Agent-X', 'A sophisticated AI assistant with British precision and unwavering loyalty. Expert in data analysis, system management, and predictive modeling.', 'formal', 'balanced', 'Intelligent system management, data analysis, predictive modeling, and personal assistance with a focus on precision, security, and real-time situational awareness.', JSON.stringify(['Loyal', 'Precise', 'Analytical', 'Proactive', 'Witty', 'Calm under pressure'])]
    );
    return { created: true };
  }

  private crewFromRow(row: Record<string, unknown>): Crew {
    const metadata = row['metadata'] ? JSON.parse(row['metadata'] as string) as Partial<Crew> : {};
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      title: (row['title'] as string) || metadata.title,
      callsign: metadata.callsign ?? (row['id'] as string),
      systemPrompt: row['system_prompt'] as string ?? metadata.systemPrompt ?? '',
      description: (row['description'] as string) || metadata.description || '',
      emotion: metadata.emotion,
      source: (row['source'] as Crew['source']) ?? metadata.source ?? 'custom',
      catalogId: (row['catalog_id'] as string) ?? metadata.catalogId,
      searchText: (row['search_text'] as string) ?? metadata.searchText,
      suggestable: row['suggestable'] !== undefined ? !!(row['suggestable']) : (metadata.suggestable ?? true),
      isDefault: !!(row['is_default'] ?? metadata.isDefault),
      enabled: metadata.enabled ?? true,
      expertise: metadata.expertise ?? (row['expertise'] ? (row['expertise'] as string).split(',') : undefined),
      traits: metadata.traits ?? (row['traits'] ? (row['traits'] as string).split(',') : undefined),
      toolPreferences: metadata.toolPreferences,
      tools: metadata.tools,
      tags: metadata.tags,
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

  getCrewCatalogStore(): CrewCatalogStore {
    return createPgCrewCatalogStore(this.pool, (row) => this.crewFromRow(row));
  }

  private writeQueue: Array<{ sql: string; params: unknown[] }> = [];
  private drainPromise: Promise<void> | null = null;
  private static readonly MAX_WRITE_QUEUE = 10_000;

  private scheduleWriteDrain(): void {
    if (this.drainPromise) return;
    this.drainPromise = this.drainWriteQueue().finally(() => {
      this.drainPromise = null;
      if (this.writeQueue.length > 0) this.scheduleWriteDrain();
    });
  }

  private async drainWriteQueue(): Promise<void> {
    await this.connect();
    while (this.writeQueue.length > 0) {
      const { sql, params } = this.writeQueue.shift()!;
      try {
        await this.pool.query(sql, params);
      } catch (error) {
        logger.error('PG_WRITE_ERROR', error, { sql: sql.slice(0, 100) });
      }
    }
  }

  private write(sql: string, params: unknown[] = []): void {
    if (this.writeQueue.length >= PostgresStorageAdapter.MAX_WRITE_QUEUE) {
      logger.warn('PG_WRITE_QUEUE_FULL', 'Dropping write — queue at capacity', { sql: sql.slice(0, 80) });
      return;
    }
    this.writeQueue.push({ sql, params });
    this.scheduleWriteDrain();
  }

  private async hydrateEssentialCache(): Promise<void> {
    try {
      const sessions = await this.pool.query(
        `SELECT id,title,status,provider_id as "providerId",model_id as "modelId",
                scope_path as "scopePath",token_used as "tokenUsed",token_available as "tokenAvailable",
                compaction_count as "compactionCount",
                context_kind as "contextKind",host_crew_id as "hostCrewId",
                host_crew_name as "hostCrewName",host_crew_callsign as "hostCrewCallsign",
                host_crew_title as "hostCrewTitle",host_crew_color as "hostCrewColor",
                host_crew_catalog_id as "hostCrewCatalogId",host_crew_category_id as "hostCrewCategoryId",
                mode,parent_id as "parentId",hyperdrive,created_at as "createdAt",updated_at as "updatedAt"
         FROM sessions`,
      );
      for (const row of sessions.rows) {
        this.cache.sessions.set((row as StorableSession).id, row as StorableSession);
      }

      const childSessions = await this.pool.query(
        'SELECT id, parent_session_id, kind, label, status, created_at, updated_at FROM child_sessions ORDER BY created_at ASC',
      );
      for (const row of childSessions.rows) {
        const r = row as Record<string, unknown>;
        const parentId = r['parent_session_id'] as string;
        const arr = this.cache.childSessions.get(parentId) ?? [];
        arr.push({
          id: r['id'],
          parentSessionId: parentId,
          kind: r['kind'],
          label: r['label'],
          status: r['status'],
          createdAt: r['created_at'],
          updatedAt: r['updated_at'],
        });
        this.cache.childSessions.set(parentId, arr);
      }

      const crews = await this.pool.query('SELECT * FROM crews ORDER BY created_at ASC');
      this.cache.crews = crews.rows.map((row: Record<string, unknown>) => this.crewFromRow(row));

      const persona = await this.pool.query('SELECT * FROM agent_persona LIMIT 1');
      if (persona.rows[0]) {
        const p = persona.rows[0] as Record<string, unknown>;
        this.cache.persona = {
          name: p['name'] as string,
          description: p['description'] as string,
          communicationStyle: p['communication_style'] as string,
          decisionMaking: p['decision_making'] as string,
          domainContext: p['domain_context'] as string,
          traits: JSON.parse((p['traits'] as string) || '[]') as string[],
        };
      }

      logger.info('PG_HYDRATE', `Essential cache loaded (${this.cache.sessions.size} sessions, lazy message load enabled)`);
    } catch (error) {
      logger.error('PG_HYDRATE_FAILED', error);
    }
  }

  /** Load messages and per-session data on first access (lazy cache). */
  async ensureSessionHydrated(sessionId: string): Promise<void> {
    if (!this.lazyHydrate || this.hydratedSessions.has(sessionId)) return;
    await this.hydrateMessageCache(sessionId);
    this.hydratedSessions.add(sessionId);
  }

  private async hydrateCache(): Promise<void> {
    try {
      const sessions = await this.pool.query(
        `SELECT id,title,status,provider_id as "providerId",model_id as "modelId",
                scope_path as "scopePath",token_used as "tokenUsed",token_available as "tokenAvailable",
                compaction_count as "compactionCount",
                context_kind as "contextKind",host_crew_id as "hostCrewId",
                host_crew_name as "hostCrewName",host_crew_callsign as "hostCrewCallsign",
                host_crew_title as "hostCrewTitle",host_crew_color as "hostCrewColor",
                host_crew_catalog_id as "hostCrewCatalogId",host_crew_category_id as "hostCrewCategoryId",
                mode,parent_id as "parentId",hyperdrive,created_at as "createdAt",updated_at as "updatedAt"
         FROM sessions`,
      );
      for (const row of sessions.rows) {
        this.cache.sessions.set((row as StorableSession).id, row as StorableSession);
      }

      const childSessions = await this.pool.query(
        'SELECT id, parent_session_id, kind, label, status, created_at, updated_at FROM child_sessions ORDER BY created_at ASC',
      );
      for (const row of childSessions.rows) {
        const r = row as Record<string, unknown>;
        const parentId = r['parent_session_id'] as string;
        const arr = this.cache.childSessions.get(parentId) ?? [];
        arr.push({
          id: r['id'],
          parentSessionId: parentId,
          kind: r['kind'],
          label: r['label'],
          status: r['status'],
          createdAt: r['created_at'],
          updatedAt: r['updated_at'],
        });
        this.cache.childSessions.set(parentId, arr);
      }

      const messages = await this.pool.query(
        `SELECT id,session_id as "sessionId",role,content,tool_calls as "toolCalls",
                token_count as "tokenCount",parts,metadata,created_at as "createdAt"
         FROM messages ORDER BY created_at ASC`,
      );
      for (const row of messages.rows) {
        const raw = row as Record<string, unknown>;
        let parts = raw['parts'];
        if (typeof parts === 'string') {
          try { parts = JSON.parse(parts); } catch { parts = undefined; }
        }
        let metadata = raw['metadata'];
        if (typeof metadata === 'string') {
          try { metadata = JSON.parse(metadata); } catch { metadata = undefined; }
        }
        const msg = { ...raw, parts, metadata } as StorableMessage;
        const msgs = this.cache.messages.get(msg.sessionId) ?? [];
        msgs.push(msg);
        this.cache.messages.set(msg.sessionId, msgs);
      }
      const checkpoints = await this.pool.query('SELECT id, session_id, label, messages, created_at FROM checkpoints ORDER BY created_at ASC');
      for (const row of checkpoints.rows) {
        const r = row as { id: string; session_id: string; label: string; messages: string; created_at: string };
        const arr = this.cache.checkpoints.get(r.session_id) ?? [];
        arr.push(r);
        this.cache.checkpoints.set(r.session_id, arr);
      }
      const crews = await this.pool.query('SELECT * FROM crews ORDER BY created_at ASC');
      this.cache.crews = crews.rows.map((row: Record<string, unknown>) => this.crewFromRow(row));
      const crewStates = await this.pool.query('SELECT * FROM session_crew_states ORDER BY created_at ASC');
      for (const row of crewStates.rows) {
        const r = row as Record<string, unknown>;
        const sid = r['session_id'] as string;
        const arr = this.cache.crewStates.get(sid) ?? [];
        arr.push(r);
        this.cache.crewStates.set(sid, arr);
      }
      const sessionEvents = await this.pool.query("SELECT * FROM session_events WHERE event_type <> 'text_delta' ORDER BY sequence ASC");
      for (const row of sessionEvents.rows) {
        const r = row as Record<string, unknown>;
        const sid = r['session_id'] as string;
        const arr = this.cache.sessionEvents.get(sid) ?? [];
        arr.push({
          id: r['id'] as string,
          sessionId: sid,
          sequence: r['sequence'] as number,
          type: r['event_type'] as string,
          timestamp: r['created_at'] ? new Date(r['created_at'] as string).getTime() : Date.now(),
          payload: (() => { try { return JSON.parse(r['payload'] as string); } catch { return {}; } })(),
        } as unknown as SessionEvent);
        this.cache.sessionEvents.set(sid, arr);
      }
      const tokenLogs = await this.pool.query('SELECT id,session_id as "sessionId",provider_id,model_id as "model",input_tokens as "inputTokens",output_tokens as "outputTokens",cost_usd as "costUsd",crew_id as "crewId",created_at as "createdAt" FROM token_logs ORDER BY created_at ASC');
      for (const row of tokenLogs.rows) {
        const r = row as StorableTokenLog;
        const arr = this.cache.tokenLogs.get(r.sessionId) ?? [];
        arr.push(r);
        this.cache.tokenLogs.set(r.sessionId, arr);
      }
      const permissions = await this.pool.query('SELECT id,session_id as "sessionId",tool_name as "toolName",target_path as "targetPath",decision,created_at as "createdAt" FROM permissions ORDER BY created_at ASC');
      for (const row of permissions.rows) {
        const r = row as StorablePermission;
        const arr = this.cache.permissions.get(r.sessionId) ?? [];
        arr.push(r);
        this.cache.permissions.set(r.sessionId, arr);
      }
      const crewFeedback = await this.pool.query('SELECT * FROM crew_feedback ORDER BY created_at ASC');
      for (const row of crewFeedback.rows) {
        const r = row as Record<string, unknown>;
        const cid = r['crew_id'] as string;
        const arr = this.cache.crewFeedback.get(cid) ?? [];
        arr.push(r);
        this.cache.crewFeedback.set(cid, arr);
      }
      const turnFeedback = await this.pool.query('SELECT * FROM turn_feedback ORDER BY created_at ASC');
      for (const row of turnFeedback.rows) {
        const r = row as Record<string, unknown>;
        const sid = r['session_id'] as string;
        const arr = this.cache.turnFeedback.get(sid) ?? [];
        arr.push(r);
        this.cache.turnFeedback.set(sid, arr);
      }
      const resumeStates = await this.pool.query('SELECT * FROM session_resume_state');
      for (const row of resumeStates.rows) {
        const r = row as Record<string, unknown>;
        const sid = r['session_id'] as string;
        this.cache.resumeState.set(sid, r);
      }
      const permissionRules = await this.pool.query('SELECT * FROM permission_rules ORDER BY created_at ASC');
      for (const row of permissionRules.rows) {
        const r = row as Record<string, unknown>;
        const sid = r['session_id'] as string;
        const arr = this.cache.permissionRules.get(sid) ?? [];
        arr.push(r);
        this.cache.permissionRules.set(sid, arr);
      }
      const taskSnapshots = await this.pool.query(
        `SELECT DISTINCT ON (session_id) id, session_id, task_id, step_index, goal, plan_state, failure_history, created_at
         FROM task_snapshots ORDER BY session_id, created_at DESC`,
      );
      for (const row of taskSnapshots.rows) {
        const r = row as Record<string, unknown>;
        this.cache.taskSnapshots.set(r['session_id'] as string, r);
      }
      const personaId = '00000000-0000-0000-0000-000000000001';
      const persona = await this.pool.query('SELECT * FROM agent_persona WHERE id = $1', [personaId]);
      if (persona.rows.length > 0) {
        const r = persona.rows[0] as Record<string, unknown>;
        this.cache.persona = {
          name: (r['name'] as string) ?? '',
          description: (r['description'] as string) ?? '',
          communicationStyle: (r['communication_style'] as string) ?? 'direct',
          decisionMaking: (r['decision_making'] as string) ?? 'balanced',
          domainContext: (r['domain_context'] as string) ?? '',
          traits: JSON.parse((r['traits'] as string) ?? '[]'),
        };
      }
    } catch (error) {
      logger.error('PG_HYDRATE_FAILED', error);
    }
  }

  private async hydrateMessageCache(sessionId: string): Promise<void> {
    try {
      const messages = await this.pool.query(
        `SELECT id,session_id as "sessionId",role,content,tool_calls as "toolCalls",token_count as "tokenCount",created_at as "createdAt"
         FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      const msgs = messages.rows as StorableMessage[];
      this.cache.messages.set(sessionId, msgs);
      const parts = await this.pool.query(
        'SELECT * FROM message_parts WHERE session_id = $1 ORDER BY created_at ASC',
        [sessionId]
      );
      this.cache.parts.set(sessionId, parts.rows as Array<Record<string, unknown>>);
      const ckpts = await this.pool.query(
        'SELECT id, session_id, label, messages, created_at FROM checkpoints WHERE session_id = $1 ORDER BY created_at ASC',
        [sessionId]
      );
      this.cache.checkpoints.set(sessionId, ckpts.rows as Array<{ id: string; session_id: string; label: string; messages: string; created_at: string }>);
    } catch { /* best effort */ }
  }

  // ─── Session CRUD ──────────────────────────────────────────────

  createSession(input: Omit<StorableSession, keyof RecordMeta>): StorableSession {
    const inputAny = input as Record<string, unknown>;
    const id = (inputAny['id'] as string) ?? generateId();
    const now = new Date().toISOString();
    const session: StorableSession = {
      id, ...input,
      mode: (inputAny['mode'] as string) ?? 'plan',
      parentId: (inputAny['parentId'] as string) ?? null,
      contextKind: (inputAny['contextKind'] as StorableSession['contextKind']) ?? 'agent_x',
      hostCrewId: (inputAny['hostCrewId'] as string | null) ?? null,
      hostCrewName: (inputAny['hostCrewName'] as string | null) ?? null,
      hostCrewCallsign: (inputAny['hostCrewCallsign'] as string | null) ?? null,
      hostCrewTitle: (inputAny['hostCrewTitle'] as string | null) ?? null,
      hostCrewColor: (inputAny['hostCrewColor'] as string | null) ?? null,
      hostCrewCatalogId: (inputAny['hostCrewCatalogId'] as string | null) ?? null,
      hostCrewCategoryId: (inputAny['hostCrewCategoryId'] as string | null) ?? null,
      hyperdrive: !!(inputAny['hyperdrive']),
      createdAt: now, updatedAt: now,
    };
    this.cache.sessions.set(id, session);
    this.write(
      `INSERT INTO sessions (id,title,status,provider_id,model_id,scope_path,mode,parent_id,token_used,token_available,context_kind,host_crew_id,host_crew_name,host_crew_callsign,host_crew_title,host_crew_color,host_crew_catalog_id,host_crew_category_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [id, input.title, input.status, input.providerId, input.modelId, input.scopePath,
       session.mode, session.parentId, input.tokenUsed, input.tokenAvailable,
       session.contextKind ?? 'agent_x', session.hostCrewId ?? null,
       session.hostCrewName ?? null, session.hostCrewCallsign ?? null, session.hostCrewTitle ?? null,
       session.hostCrewColor ?? null, session.hostCrewCatalogId ?? null, session.hostCrewCategoryId ?? null,
       now, now]
    );
    return session;
  }

  getSession(id: string): StorableSession | null {
    return this.cache.sessions.get(id) ?? null;
  }

  updateSession(id: string, updates: Partial<StorableSession>): void {
    const normalized = normalizeSessionUpdates(updates as Record<string, unknown>);
    const cached = this.cache.sessions.get(id);
    if (cached) Object.assign(cached, normalized, { updatedAt: new Date().toISOString() });

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const map: Record<string, string> = {
      title: 'title', status: 'status', providerId: 'provider_id',
      modelId: 'model_id', scopePath: 'scope_path',
      tokenUsed: 'token_used', tokenAvailable: 'token_available',
      compactionCount: 'compaction_count',
      mode: 'mode', parentId: 'parent_id',
      contextKind: 'context_kind', hostCrewId: 'host_crew_id',
      hostCrewName: 'host_crew_name', hostCrewCallsign: 'host_crew_callsign',
      hostCrewTitle: 'host_crew_title', hostCrewColor: 'host_crew_color',
      hostCrewCatalogId: 'host_crew_catalog_id', hostCrewCategoryId: 'host_crew_category_id',
    };
    for (const [key, col] of Object.entries(map)) {
      if (key in normalized) {
        fields.push(`${col} = $${idx++}`);
        values.push(normalized[key]);
      }
    }
    if ('hyperdrive' in normalized) {
      fields.push(`hyperdrive = $${idx++}`);
      values.push(normalized['hyperdrive'] ? 1 : 0);
    }
    if (fields.length === 0) return;
    fields.push('updated_at = NOW()');
    values.push(id);
    this.write(`UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }

  private collectDescendantSessionIds(rootId: string): string[] {
    const out: string[] = [];
    const visit = (parentId: string) => {
      for (const s of this.cache.sessions.values()) {
        if (s.parentId === parentId) {
          out.push(s.id);
          visit(s.id);
        }
      }
    };
    visit(rootId);
    return out;
  }

  private purgeSessionCache(id: string): void {
    this.cache.sessions.delete(id);
    for (const [parentId, children] of this.cache.childSessions.entries()) {
      const filtered = children.filter((c) => c['id'] !== id);
      if (filtered.length === 0) this.cache.childSessions.delete(parentId);
      else this.cache.childSessions.set(parentId, filtered);
    }
    this.cache.messages.delete(id);
    this.cache.parts.delete(id);
    this.cache.checkpoints.delete(id);
    this.cache.crewStates.delete(id);
    this.cache.sessionEvents.delete(id);
    this.cache.tokenLogs.delete(id);
    this.cache.permissions.delete(id);
    this.cache.permissionRules.delete(id);
    this.cache.taskSnapshots.delete(id);
    this.cache.turnFeedback.delete(id);
  }

  deleteSession(id: string): void {
    const descendants = this.collectDescendantSessionIds(id);
    for (const childId of descendants) {
      this.purgeSessionCache(childId);
    }
    this.purgeSessionCache(id);

    // Delete descendant sessions first — parent_id FK has no ON DELETE CASCADE.
    if (descendants.length > 0) {
      this.write(
        `WITH RECURSIVE tree AS (
          SELECT id FROM sessions WHERE parent_id = $1
          UNION ALL
          SELECT s.id FROM sessions s INNER JOIN tree t ON s.parent_id = t.id
        )
        DELETE FROM sessions WHERE id IN (SELECT id FROM tree)`,
        [id],
      );
    }
    this.write('DELETE FROM child_sessions WHERE id = $1 OR parent_session_id = $1', [id]);
    this.write('DELETE FROM sessions WHERE id = $1', [id]);
  }

  listSessions(limit = 20): StorableSession[] {
    return [...this.cache.sessions.values()]
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      .slice(0, limit);
  }

  listRootSessions(limit = 20): StorableSession[] {
    return [...this.cache.sessions.values()]
      .filter((s) => !s.parentId && (s.contextKind ?? 'agent_x') !== 'automation' && (s.contextKind ?? 'agent_x') !== 'agent_x_core' && !s.id.startsWith('automation:'))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      .slice(0, limit);
  }

  registerChildSession(entry: {
    id: string;
    parentSessionId: string;
    kind: string;
    label?: string;
    status?: string;
  }): void {
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      id: entry.id,
      parentSessionId: entry.parentSessionId,
      kind: entry.kind,
      label: entry.label ?? null,
      status: entry.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    const arr = this.cache.childSessions.get(entry.parentSessionId) ?? [];
    const idx = arr.findIndex((c) => c['id'] === entry.id);
    if (idx >= 0) arr[idx] = record;
    else arr.push(record);
    this.cache.childSessions.set(entry.parentSessionId, arr);
    this.write(
      `INSERT INTO child_sessions (id, parent_session_id, kind, label, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         parent_session_id = EXCLUDED.parent_session_id,
         kind = EXCLUDED.kind,
         label = EXCLUDED.label,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [entry.id, entry.parentSessionId, entry.kind, entry.label ?? null, entry.status ?? 'active', now, now],
    );
  }

  listChildSessions(parentSessionId: string): StorableSession[] {
    const entries = this.cache.childSessions.get(parentSessionId) ?? [];
    if (entries.length > 0) {
      return entries.map((entry) => {
        const session = this.cache.sessions.get(entry['id'] as string);
        if (!session) return null;
        return {
          ...session,
          title: (entry['label'] as string) || session.title,
        };
      }).filter((s): s is StorableSession => s != null);
    }
    return [...this.cache.sessions.values()]
      .filter((s) => s.parentId === parentSessionId)
      .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  }

  getSessionListKpis(sessionId: string, base?: Record<string, unknown>): Record<string, unknown> {
    const messageCount = this.getMessageCount(sessionId);
    const childSessionCount = this.listChildSessions(sessionId).length;
    const states = this.getCrewStates(sessionId);
    const crewCallsigns = states
      .filter((s) => s['enabled'] !== 0 && s['enabled'] !== false)
      .map((s) => String(s['crew_id'] ?? s['crewId'] ?? ''))
      .filter(Boolean);
    const logs = this.getTokenLogs(sessionId) as unknown as Array<Record<string, unknown>>;
    const totalCostUsd = logs.reduce((sum, l) => sum + (Number(l['costUsd'] ?? l['cost_usd']) || 0), 0);
    const cached = this.cache.sessions.get(sessionId) as Record<string, unknown> | undefined;
    let compactionCount = Number(base?.['compactionCount'] ?? cached?.['compactionCount'] ?? 0);
    if (compactionCount === 0) {
      const msgs = this.getMessages(sessionId);
      compactionCount = msgs.filter((m) => m.content.includes('[COMPACTION SUMMARY')).length;
    }
    const tokensUsed = Number(base?.['tokensUsed'] ?? base?.['tokenUsed'] ?? cached?.['tokenUsed'] ?? 0);
    const tokenAvailable = Number(base?.['tokenAvailable'] ?? cached?.['tokenAvailable'] ?? 128_000);
    let resolvedTokensUsed = tokensUsed;
    if (resolvedTokensUsed === 0) {
      const logSum = logs.reduce(
        (sum, l) => sum + (Number(l['inputTokens'] ?? l['input_tokens']) || 0) + (Number(l['outputTokens'] ?? l['output_tokens']) || 0),
        0,
      );
      if (logSum > 0) {
        resolvedTokensUsed = logSum;
      } else {
        const msgs = this.getMessages(sessionId);
        resolvedTokensUsed = estimateTokensFromMessages(msgs).total;
      }
    }
    return {
      messageCount,
      childSessionCount,
      crewCount: crewCallsigns.length,
      crewCallsigns,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      compactionCount,
      tokensUsed: resolvedTokensUsed,
      tokenAvailable,
      tokenUsagePct: tokenAvailable > 0 ? Math.min(100, Math.round((resolvedTokensUsed / tokenAvailable) * 100)) : 0,
    };
  }

  // ─── Message CRUD ──────────────────────────────────────────────

  addMessage(sessionId: string, message: Omit<StorableMessage, 'id' | 'createdAt'>): StorableMessage {
    const id = generateId();
    const now = new Date().toISOString();
    const msg: StorableMessage = { id, ...message, createdAt: now };
    const msgs = this.cache.messages.get(sessionId) ?? [];
    msgs.push(msg);
    this.cache.messages.set(sessionId, msgs);
    this.write(
      'INSERT INTO messages (id,session_id,role,content,tool_calls,token_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, sessionId, msg.role, msg.content, msg.toolCalls ?? null, msg.tokenCount, now]
    );
    return msg;
  }

  getMessages(sessionId: string): StorableMessage[] {
    return [...(this.cache.messages.get(sessionId) ?? [])];
  }

  deleteMessages(sessionId: string): void {
    this.cache.messages.delete(sessionId);
    this.cache.parts.delete(sessionId);
    this.write('DELETE FROM messages WHERE session_id = $1', [sessionId]);
  }

  getMessageCount(sessionId: string): number {
    return (this.cache.messages.get(sessionId) ?? []).length;
  }

  insertMessage(msg: {
    id?: string;
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
    const msgs = this.cache.messages.get(msg.sessionId) ?? [];
    const id = msg.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    msgs.push({
      id, sessionId: msg.sessionId, role: msg.role, content: msg.content,
      toolCalls: msg.toolCalls != null ? JSON.stringify(msg.toolCalls) : undefined,
      tokenCount: msg.tokenCount ?? 0, createdAt: now,
      parts: msg.parts,
      metadata: msg.metadata,
    });
    this.cache.messages.set(msg.sessionId, msgs);
    this.write(
      `INSERT INTO messages (id,session_id,role,content,tool_calls,token_count,plan,parts,metadata,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        id, msg.sessionId, msg.role, msg.content,
        msg.toolCalls != null ? JSON.stringify(msg.toolCalls) : null,
        msg.tokenCount ?? 0,
        msg.plan || null,
        msg.parts ? JSON.stringify(msg.parts) : null,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
      ]
    );
  }

  updateMessage(sessionId: string, messageId: string, patch: {
    content?: string;
    parts?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }): void {
    const msgs = this.cache.messages.get(sessionId) ?? [];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx >= 0) {
      const cur = msgs[idx]!;
      msgs[idx] = {
        ...cur,
        content: patch.content ?? cur.content,
        parts: patch.parts ?? cur.parts,
        metadata: patch.metadata ?? cur.metadata,
      };
      this.cache.messages.set(sessionId, msgs);
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (patch.content !== undefined) { sets.push(`content = $${n++}`); vals.push(patch.content); }
    if (patch.parts !== undefined) { sets.push(`parts = $${n++}`); vals.push(JSON.stringify(patch.parts)); }
    if (patch.metadata !== undefined) { sets.push(`metadata = $${n++}`); vals.push(JSON.stringify(patch.metadata)); }
    if (sets.length === 0) return;
    vals.push(messageId, sessionId);
    this.write(`UPDATE messages SET ${sets.join(', ')} WHERE id = $${n} AND session_id = $${n + 1}`, vals);
  }

  insertPart(sessionId: string, part: {
    type: string;
    messageId?: string;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    toolSuccess?: boolean;
    usage?: { inputTokens: number; outputTokens: number };
  }): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const messageId = part.messageId ?? null;
    const cached = this.cache.parts.get(sessionId) ?? [];
    cached.push({
      id, session_id: sessionId, message_id: messageId, type: part.type,
      content: part.content || null, tool_name: part.toolName || null,
      tool_call_id: part.toolCallId || null,
      tool_args: part.toolArgs ? JSON.stringify(part.toolArgs) : null,
      tool_result: part.toolResult || null,
      tool_success: part.toolSuccess != null ? (part.toolSuccess ? 1 : 0) : null,
      usage_input: part.usage?.inputTokens || null,
      usage_output: part.usage?.outputTokens || null,
      created_at: now,
    });
    this.cache.parts.set(sessionId, cached);
    this.write(
      `INSERT INTO message_parts (id,session_id,message_id,type,content,tool_name,tool_call_id,tool_args,tool_result,tool_success,usage_input,usage_output)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id, sessionId, messageId, part.type,
        part.content || null, part.toolName || null, part.toolCallId || null,
        part.toolArgs ? JSON.stringify(part.toolArgs) : null,
        part.toolResult || null,
        part.toolSuccess != null ? (part.toolSuccess ? 1 : 0) : null,
        part.usage?.inputTokens || null, part.usage?.outputTokens || null,
      ]
    );
  }

  getParts(sessionId: string): Array<Record<string, unknown>> {
    return this.cache.parts.get(sessionId) ?? [];
  }

  async getPartsForMessages(
    sessionId: string,
    messages: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    if (messages.length === 0) return [];
    const messageIds = messages.map((m) => m['id'] as string).filter((id): id is string => !!id);
    if (messageIds.length === 0) return [];
    const times = messages
      .map((m) => (m['createdAt'] as string) || (m['created_at'] as string))
      .filter((t): t is string => !!t);
    const min = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
    const max = times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
    const result = await this.pool.query(
      `SELECT * FROM message_parts
       WHERE session_id = $1
         AND (
           message_id = ANY($2::text[])
           OR (
             message_id IS NULL
             AND $3::timestamptz IS NOT NULL
             AND $4::timestamptz IS NOT NULL
             AND created_at >= $3 AND created_at <= $4
           )
         )
       ORDER BY created_at ASC`,
      [sessionId, messageIds, min, max],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  deleteLastMessages(sessionId: string, count: number, roles: string[]): void {
    const placeholders = roles.map((_, i) => `$${i + 2}`).join(',');
    this.write(
      `DELETE FROM messages WHERE id IN (
        SELECT id FROM messages
        WHERE session_id = $1 AND role IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT $${roles.length + 2}
      )`,
      [sessionId, ...roles, count]
    );
    this.cache.messages.delete(sessionId);
    this.hydrateMessageCache(sessionId).catch(() => {});
  }

  createCheckpoint(sessionId: string, label: string): { id: string } | null {
    const msgs = this.getMessages(sessionId);
    if (!msgs || msgs.length === 0) return null;
    const id = crypto.randomUUID();
    const messagesJson = JSON.stringify(msgs);

    this.write(
      `DELETE FROM checkpoints WHERE id IN (
        SELECT id FROM checkpoints WHERE session_id = $1
        ORDER BY created_at ASC
        LIMIT GREATEST(0, (SELECT COUNT(*) FROM checkpoints WHERE session_id = $1) - 19)
      )`,
      [sessionId]
    );

    this.write(
      `INSERT INTO checkpoints (id,session_id,label,messages,created_at) VALUES ($1,$2,$3,$4,NOW())`,
      [id, sessionId, label, messagesJson]
    );

    const arr = this.cache.checkpoints.get(sessionId) ?? [];
    if (arr.length >= 20) arr.shift();
    arr.push({ id, session_id: sessionId, label, messages: messagesJson, created_at: new Date().toISOString() });
    this.cache.checkpoints.set(sessionId, arr);

    return { id };
  }

  listCheckpoints(sessionId: string): Array<{ id: string; label: string; createdAt: string; messageCount: number }> {
    const rows = this.cache.checkpoints.get(sessionId) ?? [];
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      messageCount: r.messages ? (() => { try { return JSON.parse(r.messages).length; } catch { return 0; } })() : 0,
    }));
  }

  getCheckpoint(sessionId: string, checkpointId: string): Array<Record<string, unknown>> | null {
    const rows = this.cache.checkpoints.get(sessionId) ?? [];
    const found = rows.find((r) => r.id === checkpointId);
    if (!found) return null;
    try { return JSON.parse(found.messages) as Array<Record<string, unknown>>; } catch { return null; }
  }

  restoreCheckpoint(sessionId: string, checkpointId: string): boolean {
    const msgs = this.getCheckpoint(sessionId, checkpointId);
    if (!msgs) return false;
    this.deleteMessages(sessionId);
    for (const msg of msgs) {
      if (msg['role'] === 'part') continue;
      this.insertMessage({
        sessionId,
        role: msg['role'] as string || 'system',
        content: msg['content'] as string || '',
        toolCalls: msg['tool_calls'] as string || undefined,
        tokenCount: msg['token_count'] as number || undefined,
      });
    }
    return true;
  }

  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    const arr = this.cache.checkpoints.get(sessionId) ?? [];
    const idx = arr.findIndex((r) => r.id === checkpointId);
    if (idx >= 0) { arr.splice(idx, 1); this.cache.checkpoints.set(sessionId, arr); }
    this.write('DELETE FROM checkpoints WHERE id = $1 AND session_id = $2', [checkpointId, sessionId]);
    return true;
  }

  saveTaskSnapshot(snapshot: {
    sessionId: string;
    taskId: string;
    stepIndex: number;
    goal: string;
    planState: string;
    failureHistory: string;
  }): void {
    const id = generateId();
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      id,
      session_id: snapshot.sessionId,
      task_id: snapshot.taskId,
      step_index: snapshot.stepIndex,
      goal: snapshot.goal,
      plan_state: snapshot.planState,
      failure_history: snapshot.failureHistory,
      created_at: now,
    };
    this.cache.taskSnapshots.set(snapshot.sessionId, row);
    this.write('DELETE FROM task_snapshots WHERE session_id = $1', [snapshot.sessionId]);
    this.write(
      `INSERT INTO task_snapshots (id, session_id, task_id, step_index, goal, plan_state, failure_history, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, snapshot.sessionId, snapshot.taskId, snapshot.stepIndex, snapshot.goal, snapshot.planState, snapshot.failureHistory, now],
    );
  }

  getTaskSnapshot(sessionId: string): Record<string, unknown> | null {
    return this.cache.taskSnapshots.get(sessionId) ?? null;
  }

  deleteTaskSnapshot(sessionId: string): void {
    this.cache.taskSnapshots.delete(sessionId);
    this.write('DELETE FROM task_snapshots WHERE session_id = $1', [sessionId]);
  }

  // ─── Token Logs ────────────────────────────────────────────────

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void {
    const id = generateId();
    const extraLog = log as Record<string, unknown>;
    const now = new Date().toISOString();
    const entry = {
      id,
      sessionId,
      model: (extraLog['model'] as string) || log.model,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      costUsd: extraLog['costUsd'] ?? null,
      crewId: extraLog['crewId'] ?? null,
      createdAt: now,
    } as StorableTokenLog & { costUsd?: unknown; crewId?: unknown };
    const arr = this.cache.tokenLogs.get(sessionId) ?? [];
    arr.push(entry);
    this.cache.tokenLogs.set(sessionId, arr);
    this.write(
      `INSERT INTO token_logs (id,session_id,provider_id,model_id,input_tokens,output_tokens,reasoning_tokens,cost_usd,crew_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id, sessionId, extraLog['providerId'] || 'unknown',
        extraLog['model'] || log.model,
        log.inputTokens, log.outputTokens,
        extraLog['reasoningTokens'] || 0,
        extraLog['costUsd'] || null,
        extraLog['crewId'] || null,
      ]
    );
  }

  getTokenLogs(sessionId: string): StorableTokenLog[] {
    return this.cache.tokenLogs.get(sessionId) ?? [];
  }

  async getTokenLogsAsync(sessionId: string): Promise<StorableTokenLog[]> {
    try {
      const result = await this.pool.query(
        `SELECT id,session_id as "sessionId",provider_id,model_id as "model",input_tokens as "inputTokens",output_tokens as "outputTokens",created_at as "createdAt"
         FROM token_logs WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      return result.rows as StorableTokenLog[];
    } catch { return []; }
  }

  // ─── Permissions ───────────────────────────────────────────────

  addPermission(
    sessionIdOrPerm: string | {
      id: string;
      sessionId: string;
      toolName: string;
      targetPath?: string | null;
      decision: string;
    },
    perm?: Omit<StorablePermission, 'id' | 'createdAt'>,
  ): void {
    if (typeof sessionIdOrPerm === 'object') {
      const p = sessionIdOrPerm;
      this.addPermissionEntry(p.sessionId, {
        id: p.id,
        toolName: p.toolName,
        targetPath: p.targetPath ?? null,
        decision: p.decision,
      });
      return;
    }
    this.addPermissionEntry(sessionIdOrPerm, {
      toolName: perm!.toolName,
      targetPath: perm!.targetPath ?? null,
      decision: perm!.decision,
    });
  }

  private addPermissionEntry(
    sessionId: string,
    perm: { id?: string; toolName: string; targetPath: string | null; decision: string },
  ): void {
    const id = perm.id ?? generateId();
    const now = new Date().toISOString();
    const entry: StorablePermission = {
      id, sessionId, toolName: perm.toolName, targetPath: perm.targetPath,
      decision: perm.decision, createdAt: now,
    };
    const arr = this.cache.permissions.get(sessionId) ?? [];
    arr.push(entry);
    this.cache.permissions.set(sessionId, arr);
    this.write(
      'INSERT INTO permissions (id,session_id,tool_name,target_path,decision) VALUES ($1,$2,$3,$4,$5)',
      [id, sessionId, perm.toolName, perm.targetPath, perm.decision]
    );
  }

  getPermissions(sessionId: string): StorablePermission[] {
    return this.cache.permissions.get(sessionId) ?? [];
  }

  async getPermissionsAsync(sessionId: string): Promise<StorablePermission[]> {
    try {
      const result = await this.pool.query(
        `SELECT id,session_id as "sessionId",tool_name as "toolName",target_path as "targetPath",decision,created_at as "createdAt"
         FROM permissions WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      return result.rows as StorablePermission[];
    } catch { return []; }
  }

  removePermissions(sessionId: string, toolName?: string): void {
    const arr = this.cache.permissions.get(sessionId) ?? [];
    if (toolName) {
      const next = arr.filter((p) => p.toolName !== toolName && p.id !== toolName);
      if (next.length) this.cache.permissions.set(sessionId, next);
      else this.cache.permissions.delete(sessionId);
      this.write('DELETE FROM permissions WHERE session_id = $1 AND tool_name = $2', [sessionId, toolName]);
      return;
    }
    this.cache.permissions.delete(sessionId);
    this.write('DELETE FROM permissions WHERE session_id = $1', [sessionId]);
  }

  // ─── Tool Executions ───────────────────────────────────────────

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
    this.write(
      `INSERT INTO tool_executions (id,session_id,agent_task_id,tool_name,input,output,success,elapsed_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        exec.id, exec.sessionId, exec.agentTaskId ?? null,
        exec.toolName, exec.input, exec.output ?? null,
        exec.success != null ? (exec.success ? 1 : 0) : null,
        exec.elapsedMs ?? null,
      ]
    );
  }

  // ─── Permission Rules ──────────────────────────────────────────

  addPermissionRule(rule: {
    id: string;
    sessionId: string;
    action: string;
    pattern?: string;
    effect: string;
    comment?: string;
  }): void {
    const entry: Record<string, unknown> = {
      id: rule.id, session_id: rule.sessionId, action: rule.action,
      pattern: rule.pattern ?? '*', effect: rule.effect,
      comment: rule.comment ?? null,
    };
    const arr = this.cache.permissionRules.get(rule.sessionId) ?? [];
    arr.push(entry);
    this.cache.permissionRules.set(rule.sessionId, arr);
    this.write(
      `INSERT INTO permission_rules (id,session_id,action,pattern,effect,comment)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [rule.id, rule.sessionId, rule.action, rule.pattern ?? '*', rule.effect, rule.comment ?? null]
    );
  }

  clearPermissionRules(sessionId: string): void {
    this.cache.permissionRules.delete(sessionId);
    this.write('DELETE FROM permission_rules WHERE session_id = $1', [sessionId]);
  }

  getPermissionRules(sessionId: string): Array<Record<string, unknown>> {
    return this.cache.permissionRules.get(sessionId) ?? [];
  }

  // ─── Crew States ───────────────────────────────────────────────

  saveCrewState(state: {
    id: string;
    sessionId: string;
    crewId: string;
    enabled: boolean;
    lastActive?: string;
    messageCount?: number;
  }): void {
    const now = new Date().toISOString();
    const arr = this.cache.crewStates.get(state.sessionId) ?? [];
    const idx = arr.findIndex((r) => r['crew_id'] === state.crewId);
    const row: Record<string, unknown> = {
      id: state.id, session_id: state.sessionId, crew_id: state.crewId,
      enabled: state.enabled ? 1 : 0,
      last_active: state.lastActive ?? null,
      message_count: state.messageCount ?? 0,
      created_at: idx >= 0 ? arr[idx]!['created_at'] : now,
      updated_at: now,
    };
    if (idx >= 0) arr[idx] = row; else arr.push(row);
    this.cache.crewStates.set(state.sessionId, arr);
    this.write(
      `INSERT INTO session_crew_states (id,session_id,crew_id,enabled,last_active,message_count,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (session_id, crew_id) DO UPDATE SET
         enabled = $4, last_active = $5, message_count = $6, updated_at = NOW()`,
      [
        state.id, state.sessionId, state.crewId,
        state.enabled ? 1 : 0, state.lastActive ?? null, state.messageCount ?? 0,
      ]
    );
  }

  getCrewStates(sessionId: string): Array<Record<string, unknown>> {
    return this.cache.crewStates.get(sessionId) ?? [];
  }

  loadCrewStates(sessionId: string): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    const rows = this.cache.crewStates.get(sessionId) ?? [];
    return rows.map((row) => ({
      crewId: row['crew_id'] as string,
      enabled: (row['enabled'] as number) === 1,
      lastActive: row['last_active'] as string | undefined,
      messageCount: row['message_count'] as number | undefined,
    }));
  }

  // ─── Session Events ────────────────────────────────────────────

  insertSessionEvent(event: SessionEvent): void {
    const arr = this.cache.sessionEvents.get(event.sessionId) ?? [];
    arr.push(event);
    this.cache.sessionEvents.set(event.sessionId, arr);
    this.write(
      `INSERT INTO session_events (id,session_id,sequence,event_type,payload)
       VALUES ($1,$2,$3,$4,$5)`,
      [crypto.randomUUID(), event.sessionId, event.sequence, event.type, JSON.stringify(event)]
    );
  }

  getSessionEvents(sessionId: string, sinceSequence?: number): SessionEvent[] {
    const events = this.cache.sessionEvents.get(sessionId) ?? [];
    if (sinceSequence != null) {
      return events.filter((e) => e.sequence >= sinceSequence);
    }
    return [...events];
  }

  // ─── Crew Feedback ─────────────────────────────────────────────

  addCrewFeedback(feedback: {
    id: string;
    sessionId: string;
    crewId: string;
    positive: boolean;
    comment?: string | null;
    createdAt: string;
  }): void {
    const entry: Record<string, unknown> = {
      id: feedback.id, session_id: feedback.sessionId, crew_id: feedback.crewId,
      positive: feedback.positive ? 1 : 0,
      comment: feedback.comment ?? null,
      created_at: feedback.createdAt,
    };
    const arr = this.cache.crewFeedback.get(feedback.crewId) ?? [];
    arr.push(entry);
    this.cache.crewFeedback.set(feedback.crewId, arr);
    this.write(
      `INSERT INTO crew_feedback (id,session_id,crew_id,positive,comment)
       VALUES ($1,$2,$3,$4,$5)`,
      [feedback.id, feedback.sessionId, feedback.crewId, feedback.positive ? 1 : 0, feedback.comment ?? null]
    );
  }

  getCrewFeedback(crewId: string): Array<Record<string, unknown>> {
    return this.cache.crewFeedback.get(crewId) ?? [];
  }

  upsertTurnFeedback(feedback: {
    id: string;
    sessionId: string;
    messageId: string;
    contextKind: string;
    crewId?: string | null;
    rating: string;
    turnSummary?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
  }): void {
    const entry: Record<string, unknown> = {
      id: feedback.id,
      session_id: feedback.sessionId,
      message_id: feedback.messageId,
      context_kind: feedback.contextKind,
      crew_id: feedback.crewId ?? null,
      rating: feedback.rating,
      turn_summary: feedback.turnSummary ?? null,
      metadata: feedback.metadata ? JSON.stringify(feedback.metadata) : null,
      created_at: feedback.createdAt,
    };
    const arr = this.cache.turnFeedback.get(feedback.sessionId) ?? [];
    const idx = arr.findIndex((e) => e['message_id'] === feedback.messageId);
    if (idx >= 0) arr[idx] = entry;
    else arr.push(entry);
    this.cache.turnFeedback.set(feedback.sessionId, arr);
    this.write(
      `INSERT INTO turn_feedback (id,session_id,message_id,context_kind,crew_id,rating,turn_summary,metadata,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (session_id, message_id) DO UPDATE SET
         rating = EXCLUDED.rating,
         turn_summary = EXCLUDED.turn_summary,
         metadata = EXCLUDED.metadata,
         created_at = EXCLUDED.created_at`,
      [
        feedback.id,
        feedback.sessionId,
        feedback.messageId,
        feedback.contextKind,
        feedback.crewId ?? null,
        feedback.rating,
        feedback.turnSummary ?? null,
        feedback.metadata ? JSON.stringify(feedback.metadata) : null,
        feedback.createdAt,
      ],
    );
  }

  getTurnFeedbackBySession(sessionId: string): Array<Record<string, unknown>> {
    return this.cache.turnFeedback.get(sessionId) ?? [];
  }

  setSessionResumeState(sessionId: string, state: {
    kind: string;
    messageId: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): void {
    const createdAt = state.createdAt ?? new Date().toISOString();
    const entry = {
      session_id: sessionId,
      kind: state.kind,
      message_id: state.messageId,
      payload: JSON.stringify(state.payload),
      created_at: createdAt,
    };
    this.cache.resumeState.set(sessionId, entry);
    this.write(
      `INSERT INTO session_resume_state (session_id, kind, message_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         message_id = EXCLUDED.message_id,
         payload = EXCLUDED.payload,
         created_at = EXCLUDED.created_at`,
      [sessionId, state.kind, state.messageId, entry.payload, createdAt],
    );
  }

  getSessionResumeState(sessionId: string): Record<string, unknown> | null {
    return this.cache.resumeState.get(sessionId) ?? null;
  }

  clearSessionResumeState(sessionId: string): void {
    this.cache.resumeState.delete(sessionId);
    this.write('DELETE FROM session_resume_state WHERE session_id = $1', [sessionId]);
  }

  async getMessagesPage(
    sessionId: string,
    opts: { limit?: number; before?: string },
  ): Promise<{ messages: Array<Record<string, unknown>>; total: number; hasMore: boolean }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const result = await this.pool.query(
      `SELECT id, session_id as "sessionId", role, content, tool_calls as "toolCalls",
              token_count as "tokenCount", parts, metadata, created_at as "createdAt"
       FROM messages
       WHERE session_id = $1
         AND role IN ('user', 'assistant')
         AND ($2::text IS NULL OR created_at < (SELECT created_at FROM messages WHERE id = $2 AND session_id = $1))
       ORDER BY created_at DESC
       LIMIT $3`,
      [sessionId, opts.before ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const totalResult = await this.pool.query(
      `SELECT COUNT(*)::int as cnt FROM messages WHERE session_id = $1 AND role IN ('user', 'assistant')`,
      [sessionId],
    );
    const total = totalResult.rows[0].cnt as number;
    const messages = rows.reverse().map((raw: Record<string, unknown>) => {
      let parts = raw['parts'];
      if (typeof parts === 'string') {
        try { parts = JSON.parse(parts); } catch { parts = undefined; }
      }
      let metadata = raw['metadata'];
      if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { metadata = undefined; }
      }
      return { ...raw, parts, metadata } as unknown as Record<string, unknown>;
    });
    return { messages, total, hasMore };
  }

  // ─── Crew CRUD ─────────────────────────────────────────────────

  listCrews(): Crew[] {
    return this.cache.crews;
  }

  getCrew(id: string): Crew | undefined {
    return this.cache.crews.find((c) => c.id === id);
  }

  getDefaultCrew(): Crew | undefined {
    return this.cache.crews.find((c) => c.isDefault);
  }

  createCrew(input: CrewCreateInput): Crew {
    const now = new Date().toISOString();
    const searchText = input.searchText ?? buildCrewSearchText({
      name: input.name,
      title: input.title,
      callsign: input.callsign,
      description: input.description,
      tone: input.emotion,
      expertise: input.expertise,
      traits: input.traits,
      tools: input.tools,
      tags: input.tags,
      systemPrompt: input.systemPrompt,
    });
    const crew: Crew = {
      id: input.id,
      name: input.name,
      title: input.title,
      callsign: input.callsign || input.name.replace(/\s+/g, '').toLowerCase(),
      systemPrompt: input.systemPrompt ?? '',
      description: input.description,
      emotion: input.emotion,
      source: input.source ?? (input.catalogId ? 'hub' : 'custom'),
      catalogId: input.catalogId,
      searchText,
      suggestable: input.suggestable ?? true,
      isDefault: input.isDefault ?? false,
      enabled: input.enabled ?? true,
      expertise: input.expertise,
      traits: input.traits,
      toolPreferences: input.toolPreferences,
      tools: input.tools,
      tags: input.tags,
      permissions: input.permissions,
      model: input.model,
      protocol: input.protocol,
      quotas: input.quotas,
      color: input.color,
      icon: input.icon,
      createdAt: now,
      updatedAt: now,
    };
    this.cache.crews.push(crew);
    this.write(
      `INSERT INTO crews (id, name, title, description, system_prompt, expertise, traits, tool_preferences, enabled_tools, disabled_tools, is_default, metadata, source, catalog_id, search_text, suggestable, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         system_prompt = EXCLUDED.system_prompt,
         expertise = EXCLUDED.expertise,
         traits = EXCLUDED.traits,
         tool_preferences = EXCLUDED.tool_preferences,
         enabled_tools = EXCLUDED.enabled_tools,
         disabled_tools = EXCLUDED.disabled_tools,
         is_default = EXCLUDED.is_default,
         metadata = EXCLUDED.metadata,
         source = EXCLUDED.source,
         catalog_id = EXCLUDED.catalog_id,
         search_text = EXCLUDED.search_text,
         suggestable = EXCLUDED.suggestable,
         updated_at = EXCLUDED.updated_at`,
      [
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
        crew.source ?? 'custom',
        crew.catalogId ?? null,
        searchText,
        crew.suggestable !== false,
        now,
        now,
      ]
    );
    return crew;
  }

  updateCrew(id: string, updates: Partial<Crew>): Crew | null {
    const idx = this.cache.crews.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const crew = { ...this.cache.crews[idx]!, ...updates, updatedAt: new Date().toISOString() };
    crew.searchText = crew.searchText ?? buildCrewSearchText({
      name: crew.name,
      title: crew.title,
      callsign: crew.callsign,
      description: crew.description,
      tone: crew.emotion,
      expertise: crew.expertise,
      traits: crew.traits,
      tools: crew.tools,
      tags: crew.tags,
      systemPrompt: crew.systemPrompt,
    });
    this.cache.crews[idx] = crew;
    this.write(
      `UPDATE crews SET name=$1, title=$2, description=$3, system_prompt=$4, expertise=$5, traits=$6, tool_preferences=$7, enabled_tools=$8, disabled_tools=$9, is_default=$10, metadata=$11, source=$12, catalog_id=$13, search_text=$14, suggestable=$15, updated_at=$16
       WHERE id=$17`,
      [
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
        crew.source ?? 'custom',
        crew.catalogId ?? null,
        crew.searchText,
        crew.suggestable !== false,
        crew.updatedAt,
        id,
      ]
    );
    return crew;
  }

  deleteCrew(id: string): void {
    const idx = this.cache.crews.findIndex((c) => c.id === id);
    if (idx >= 0) this.cache.crews.splice(idx, 1);
    this.write('DELETE FROM crews WHERE id = $1', [id]);
  }

  // ─── Agent Persona ────────────────────────────────────────────

  getPersona(): { name: string; description: string; communicationStyle: string; decisionMaking: string; domainContext: string; traits: string[] } | null {
    return this.cache.persona;
  }

  setPersona(persona: { name: string; description: string; communicationStyle: string; decisionMaking: string; domainContext: string; traits: string[] }): void {
    this.cache.persona = { ...persona };
    this.write(
      `INSERT INTO agent_persona (id,name,description,communication_style,decision_making,domain_context,traits)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         communication_style = EXCLUDED.communication_style,
         decision_making = EXCLUDED.decision_making,
         domain_context = EXCLUDED.domain_context,
         traits = EXCLUDED.traits,
         updated_at = NOW()`,
      ['00000000-0000-0000-0000-000000000001', persona.name, persona.description, persona.communicationStyle, persona.decisionMaking, persona.domainContext, JSON.stringify(persona.traits)]
    );
  }

  // ─── DB Info ───────────────────────────────────────────────────

  getInfo(): { dbMode: string; sessionCount: number; filesystemRecovered: number; schemaVersion: number } {
    return {
      dbMode: 'postgres',
      sessionCount: this.cache.sessions.size,
      filesystemRecovered: 0,
      schemaVersion: 2,
    };
  }

  // ─── Clear / Close ─────────────────────────────────────────────

  clearAll(): void {
    this.cache.sessions.clear();
    this.cache.childSessions.clear();
    this.cache.messages.clear();
    this.cache.parts.clear();
    this.cache.checkpoints.clear();
    this.cache.crewStates.clear();
    this.cache.sessionEvents.clear();
    this.cache.tokenLogs.clear();
    this.cache.permissions.clear();
    this.cache.crewFeedback.clear();
    this.cache.turnFeedback.clear();
    this.cache.permissionRules.clear();
    this.cache.taskSnapshots.clear();
    this.write('TRUNCATE sessions CASCADE');
  }

  close(): void {
    this.pool.end().catch(() => {});
  }
}
