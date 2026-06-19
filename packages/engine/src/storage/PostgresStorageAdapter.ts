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
import type { SessionEvent, Crew } from '@agentx/shared';
import { getLogger } from '@agentx/shared';

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

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  plan TEXT,
  metadata TEXT,
  token_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_parts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_parts_session ON message_parts(session_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_session ON token_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_permissions_session ON permissions(session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_crew_feedback_crew ON crew_feedback(crew_id);
CREATE INDEX IF NOT EXISTS idx_session_crew_states_session ON session_crew_states(session_id);

CREATE TABLE IF NOT EXISTS agent_persona (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  communication_style TEXT NOT NULL DEFAULT 'direct',
  decision_making TEXT NOT NULL DEFAULT 'balanced',
  domain_context TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

interface CacheState {
  sessions: Map<string, StorableSession>;
  messages: Map<string, StorableMessage[]>;
  crews: Crew[];
  persona: { name: string; description: string; communicationStyle: string; decisionMaking: string; domainContext: string; traits: string[] } | null;
}

export interface PostgresConfig extends PoolConfig {
  autoMigrate?: boolean;
}

export class PostgresStorageAdapter implements StorageAdapter {
  private pool: Pool;
  private connected = false;
  private cache: CacheState = { sessions: new Map(), messages: new Map(), crews: [], persona: null };

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

  private writeQueue: Array<{ sql: string; params: unknown[] }> = [];
  private writing = false;

  private async processQueue(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    while (this.writeQueue.length > 0) {
      const { sql, params } = this.writeQueue.shift()!;
      try {
        await this.pool.query(sql, params);
      } catch (error) {
        logger.error('PG_WRITE_ERROR', error, { sql: sql.slice(0, 100) });
      }
    }
    this.writing = false;
  }

  private write(sql: string, params: unknown[] = []): void {
    this.writeQueue.push({ sql, params });
    this.processQueue();
  }

  private async hydrateCache(): Promise<void> {
    try {
      const sessions = await this.pool.query(
        `SELECT id,title,status,provider_id as "providerId",model_id as "modelId",
                scope_path as "scopePath",token_used as "tokenUsed",token_available as "tokenAvailable",
                mode,parent_id as "parentId",hyperdrive,created_at as "createdAt",updated_at as "updatedAt"
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
      const crews = await this.pool.query('SELECT * FROM crews ORDER BY created_at ASC');
      this.cache.crews = crews.rows.map((row: Record<string, unknown>) => {
        const metadata = row['metadata'] ? JSON.parse(row['metadata'] as string) as Partial<Crew> : {};
        return {
          id: row['id'] as string,
          name: row['name'] as string,
          title: metadata.title,
          callsign: metadata.callsign ?? (row['id'] as string),
          systemPrompt: row['system_prompt'] as string ?? metadata.systemPrompt ?? '',
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
        } satisfies Crew;
      });
      const persona = await this.pool.query('SELECT * FROM agent_persona WHERE id = $1', ['default']);
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
      hyperdrive: !!(inputAny['hyperdrive']),
      createdAt: now, updatedAt: now,
    };
    this.cache.sessions.set(id, session);
    this.write(
      `INSERT INTO sessions (id,title,status,provider_id,model_id,scope_path,mode,token_used,token_available,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, input.title, input.status, input.providerId, input.modelId, input.scopePath,
       session.mode, input.tokenUsed, input.tokenAvailable, now, now]
    );
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
      modelId: 'model_id', scopePath: 'scope_path',
      tokenUsed: 'token_used', tokenAvailable: 'token_available',
      mode: 'mode', parentId: 'parent_id',
    };
    for (const [key, col] of Object.entries(map)) {
      if (key in updates) {
        fields.push(`${col} = $${idx++}`);
        values.push((updates as Record<string, unknown>)[key]);
      }
    }
    if ('hyperdrive' in updates) {
      fields.push(`hyperdrive = $${idx++}`);
      values.push((updates as Record<string, unknown>)['hyperdrive'] ? 1 : 0);
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
    this.write('DELETE FROM messages WHERE session_id = $1', [sessionId]);
  }

  getMessageCount(sessionId: string): number {
    return (this.cache.messages.get(sessionId) ?? []).length;
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
    metadata?: Record<string, unknown>;
  }): void {
    const msgs = this.cache.messages.get(msg.sessionId) ?? [];
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    msgs.push({
      id, sessionId: msg.sessionId, role: msg.role, content: msg.content,
      toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls as string) : null as unknown as string | undefined,
      tokenCount: msg.tokenCount ?? 0, createdAt: now,
    });
    this.cache.messages.set(msg.sessionId, msgs);
    this.write(
      `INSERT INTO messages (id,session_id,role,content,tool_calls,token_count,plan,metadata,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        id, msg.sessionId, msg.role, msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.tokenCount ?? 0,
        msg.plan || null,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
      ]
    );
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
    this.write(
      `INSERT INTO message_parts (id,session_id,type,content,tool_name,tool_call_id,tool_args,tool_result,tool_success,usage_input,usage_output)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        crypto.randomUUID(), sessionId, part.type,
        part.content || null, part.toolName || null, part.toolCallId || null,
        part.toolArgs ? JSON.stringify(part.toolArgs) : null,
        part.toolResult || null,
        part.toolSuccess != null ? (part.toolSuccess ? 1 : 0) : null,
        part.usage?.inputTokens || null, part.usage?.outputTokens || null,
      ]
    );
  }

  getParts(_sessionId: string): Array<Record<string, unknown>> {
    return [];
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
    return { id };
  }

  listCheckpoints(_sessionId: string): Array<{ id: string; label: string; createdAt: string; messageCount: number }> {
    return [];
  }

  getCheckpoint(_sessionId: string, _checkpointId: string): Array<Record<string, unknown>> | null {
    return null;
  }

  restoreCheckpoint(_sessionId: string, _checkpointId: string): boolean {
    return false;
  }

  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    this.write('DELETE FROM checkpoints WHERE id = $1 AND session_id = $2', [checkpointId, sessionId]);
    return true;
  }

  // ─── Token Logs ────────────────────────────────────────────────

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void {
    const extraLog = log as Record<string, unknown>;
    this.write(
      `INSERT INTO token_logs (id,session_id,provider_id,model_id,input_tokens,output_tokens,reasoning_tokens,cost_usd,crew_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        generateId(), sessionId, extraLog['providerId'] || 'unknown',
        extraLog['model'] || log.model,
        log.inputTokens, log.outputTokens,
        extraLog['reasoningTokens'] || 0,
        extraLog['costUsd'] || null,
        extraLog['crewId'] || null,
      ]
    );
  }

  getTokenLogs(_sessionId: string): StorableTokenLog[] {
    return [];
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

  addPermission(sessionId: string, perm: Omit<StorablePermission, 'id' | 'createdAt'>): void {
    this.write(
      'INSERT INTO permissions (id,session_id,tool_name,target_path,decision) VALUES ($1,$2,$3,$4,$5)',
      [generateId(), sessionId, perm.toolName, perm.targetPath, perm.decision]
    );
  }

  getPermissions(_sessionId: string): StorablePermission[] {
    return [];
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
    this.write(
      `INSERT INTO permission_rules (id,session_id,action,pattern,effect,comment)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [rule.id, rule.sessionId, rule.action, rule.pattern ?? '*', rule.effect, rule.comment ?? null]
    );
  }

  getPermissionRules(_sessionId: string): Array<Record<string, unknown>> {
    return [];
  }

  clearPermissionRules(sessionId: string): void {
    this.write('DELETE FROM permission_rules WHERE session_id = $1', [sessionId]);
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

  getCrewStates(_sessionId: string): Array<Record<string, unknown>> {
    return [];
  }

  loadCrewStates(_sessionId: string): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    return [];
  }

  // ─── Session Events ────────────────────────────────────────────

  insertSessionEvent(event: SessionEvent): void {
    this.write(
      `INSERT INTO session_events (id,session_id,sequence,event_type,payload)
       VALUES ($1,$2,$3,$4,$5)`,
      [crypto.randomUUID(), event.sessionId, event.sequence, event.type, JSON.stringify(event)]
    );
  }

  getSessionEvents(_sessionId: string, _sinceSequence?: number): SessionEvent[] {
    return [];
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
    this.write(
      `INSERT INTO crew_feedback (id,session_id,crew_id,positive,comment)
       VALUES ($1,$2,$3,$4,$5)`,
      [feedback.id, feedback.sessionId, feedback.crewId, feedback.positive ? 1 : 0, feedback.comment ?? null]
    );
  }

  getCrewFeedback(_crewId: string): Array<Record<string, unknown>> {
    return [];
  }

  // ─── Crew CRUD ─────────────────────────────────────────────────

  listCrews(): Crew[] {
    return this.cache.crews;
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
      ['default', persona.name, persona.description, persona.communicationStyle, persona.decisionMaking, persona.domainContext, JSON.stringify(persona.traits)]
    );
  }

  // ─── Clear / Close ─────────────────────────────────────────────

  clearAll(): void {
    this.cache.sessions.clear();
    this.cache.messages.clear();
    this.write('TRUNCATE sessions CASCADE');
  }

  close(): void {
    this.pool.end().catch(() => {});
  }
}
