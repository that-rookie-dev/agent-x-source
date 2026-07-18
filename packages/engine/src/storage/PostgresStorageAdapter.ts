import { Pool, type PoolConfig } from 'pg';
import { generateId } from '@agentx/shared';
import type {
  StorageAdapter,
  StorableSession,
  StorableMessage,
  StorableMessageInput,
  StorableTokenLog,
  RecordMeta,
} from '@agentx/shared';
import type { SessionEvent, Crew, CrewCreateInput, AgentPersonaConfig, SessionListKpis, Session } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { normalizeSessionUpdates } from '../session/session-field-utils.js';
import { estimateTokensFromMessages } from '../session/session-token-utils.js';
import { createPgCrewCatalogStore } from '../crew/postgres-crew-catalog.js';
import type { CrewCatalogStore } from '../crew/CrewSuggestionService.js';
import { PostgresBackgroundTaskStore } from '../agent/background/BackgroundTaskStore.js';
import type { BackgroundTaskStore } from '../agent/background/BackgroundTaskStore.js';
import {
  getEnvInt,
  getEnvBool,
  type CacheState,
  type PostgresConfig,
} from './pg-helpers.js';
import {
  hydrateEssentialCache,
  ensureSessionHydrated,
  hydrateCache,
  flushWriteQueue,
  hydrateMessageCache,
  collectDescendantSessionIds,
  purgeSessionCache,
  type HydrationContext,
} from './pg-hydration.js';
import {
  deleteLastMessages,
  createCheckpoint,
  restoreCheckpoint,
  type CheckpointContext,
} from './pg-checkpoints.js';
import {
  crewFromRow as crewFromRowImpl,
  migrate as migrateImpl,
  doConnect as doConnectImpl,
  type MigrationContext,
} from './pg-migration.js';
import {
  addMessage as addMessageImpl,
  getMessages as getMessagesImpl,
  deleteMessages as deleteMessagesImpl,
  getMessageCount as getMessageCountImpl,
  insertMessage as insertMessageImpl,
  updateMessage as updateMessageImpl,
  insertPart as insertPartImpl,
  getParts as getPartsImpl,
  getPartsForMessages as getPartsForMessagesImpl,
  purgeSessionContent as purgeSessionContentImpl,
  archiveSessionMessages as archiveSessionMessagesImpl,
  getMessagesPage as getMessagesPageImpl,
  type MessageContext,
} from './pg-messages.js';
import {
  addTokenLog as addTokenLogImpl,
  getTokenLogs as getTokenLogsImpl,
  getTokenLogsAsync as getTokenLogsAsyncImpl,
  type TokenLogContext,
} from './pg-token-logs.js';
import {
  setSessionResumeState as setSessionResumeStateImpl,
  getSessionResumeState as getSessionResumeStateImpl,
  clearSessionResumeState as clearSessionResumeStateImpl,
  type ResumeStateContext,
} from './pg-resume-state.js';
import {
  listCrews as listCrewsImpl,
  getCrew as getCrewImpl,
  getDefaultCrew as getDefaultCrewImpl,
  createCrew as createCrewImpl,
  updateCrew as updateCrewImpl,
  deleteCrew as deleteCrewImpl,
  type CrewContext,
} from './pg-crews.js';
import {
  saveTaskSnapshot as saveTaskSnapshotImpl,
  getTaskSnapshot as getTaskSnapshotImpl,
  deleteTaskSnapshot as deleteTaskSnapshotImpl,
  addToolExecution as addToolExecutionImpl,
  addPermissionRule as addPermissionRuleImpl,
  clearPermissionRules as clearPermissionRulesImpl,
  getPermissionRules as getPermissionRulesImpl,
  saveCrewState as saveCrewStateImpl,
  getCrewStates as getCrewStatesImpl,
  loadCrewStates as loadCrewStatesImpl,
  insertSessionEvent as insertSessionEventImpl,
  getSessionEvents as getSessionEventsImpl,
  addCrewFeedback as addCrewFeedbackImpl,
  getCrewFeedback as getCrewFeedbackImpl,
  upsertTurnFeedback as upsertTurnFeedbackImpl,
  getTurnFeedbackBySession as getTurnFeedbackBySessionImpl,
  type SessionExtrasContext,
} from './pg-session-extras.js';

export type { PostgresConfig } from './pg-helpers.js';

const logger = getLogger();

export class PostgresStorageAdapter implements StorageAdapter {
  private pool: Pool;
  private connected = false;
  private lazyHydrate: boolean;
  private onProgress?: (line: string) => void;
  private hydratedSessions = new Set<string>();
  private cache: CacheState = { sessions: new Map(), childSessions: new Map(), messages: new Map(), parts: new Map(), crews: [], persona: null, checkpoints: new Map(), crewStates: new Map(), sessionEvents: new Map(), tokenLogs: new Map(), crewFeedback: new Map(), turnFeedback: new Map(), resumeState: new Map(), permissionRules: new Map(), taskSnapshots: new Map() };

  constructor(config: PostgresConfig) {
    const poolConfig = {
      ...config,
      max: getEnvInt('PG_POOL_MAX', config.max, 20),
      idleTimeoutMillis: getEnvInt('PG_POOL_IDLE_TIMEOUT_MS', config.idleTimeoutMillis, 30_000),
      connectionTimeoutMillis: getEnvInt('PG_CONNECTION_TIMEOUT_MS', config.connectionTimeoutMillis, 5_000),
      allowExitOnIdle: getEnvBool('PG_POOL_ALLOW_EXIT_ON_IDLE', config.allowExitOnIdle, false),
    };
    this.pool = new Pool(poolConfig as PoolConfig);
    this.lazyHydrate = config.lazyHydrate !== false;
    this.onProgress = config.onProgress;
  }

  private progress(line: string): void {
    this.onProgress?.(line);
  }

  static async testConnection(connectionString: string): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    const pool = new (await import('pg')).Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
      // Avoid hanging forever on half-open TCP / flaky cloud relays.
      idleTimeoutMillis: 5_000,
    });
    try {
      const client = await pool.connect();
      try {
        const result = await client.query('SELECT version() as version');
        const pgVersion = result.rows[0]?.['version'] as string;
        return { ok: true, version: pgVersion || 'connected' };
      } finally {
        client.release();
      }
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : 'connection-failed' };
    } finally {
      await pool.end().catch(() => {});
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
    await doConnectImpl(this.migrationCtx());
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    this.connected = false;
  }

  /** Gracefully shut down the PG pool. */
  async shutdown(): Promise<void> {
    await this.disconnect();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Expose the PG pool for neural engines and other subsystems. */
  getPool(): Pool {
    return this.pool;
  }

  async migrate(): Promise<void> {
    await migrateImpl(this.migrationCtx());
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
    return crewFromRowImpl(row);
  }

  getCrewCatalogStore(): CrewCatalogStore {
    return createPgCrewCatalogStore(this.pool, (row) => this.crewFromRow(row), () => this.flushWriteQueue());
  }

  getBackgroundTaskStore(): BackgroundTaskStore {
    return new PostgresBackgroundTaskStore({
      pool: this.pool,
      write: (sql, params) => this.write(sql, params ?? []),
    });
  }

  private writeQueue: Array<{ sql: string; params: unknown[]; retries: number }> = [];
  private drainPromise: Promise<void> | null = null;
  private static readonly MAX_WRITE_QUEUE = 10_000;
  private static readonly MAX_WRITE_RETRIES = 3;

  private scheduleWriteDrain(): void {
    if (this.drainPromise) return;
    this.drainPromise = this.drainWriteQueue().finally(() => {
      this.drainPromise = null;
      if (this.writeQueue.length > 0) this.scheduleWriteDrain();
    });
  }

  /**
   * Classify a PG error as transient (retryable) or permanent (drop).
   * Transient: connection issues, timeouts, server crashes.
   * Permanent: FK violations, duplicate keys, syntax errors, permission errors.
   */
  private isTransientPgError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: string }).code ?? '';
      // Class 08: Connection exception
      // Class 53: Insufficient resources
      // Class 57: Operator intervention (server restart)
      // Class 40: Transaction rollback
      // 40001: serialization_failure
      // 40P01: deadlock_detected
      return code.startsWith('08') || code.startsWith('53') || code.startsWith('57')
        || code.startsWith('40') || code === '40001' || code === '40P01';
    }
    // Network errors, timeouts, EPIPE, etc. — retry
    return true;
  }

  private async drainWriteQueue(): Promise<void> {
    await this.connect();
    while (this.writeQueue.length > 0) {
      const item = this.writeQueue.shift()!;
      try {
        await this.pool.query(item.sql, item.params);
      } catch (error) {
        const isTransient = this.isTransientPgError(error);
        const shouldRetry = isTransient && item.retries < PostgresStorageAdapter.MAX_WRITE_RETRIES;
        if (shouldRetry) {
          // Re-enqueue at the front to preserve ordering
          this.writeQueue.unshift({ sql: item.sql, params: item.params, retries: item.retries + 1 });
          logger.warn('PG_WRITE_RETRY', `Retrying write (attempt ${item.retries + 1}/${PostgresStorageAdapter.MAX_WRITE_RETRIES})`, {
            sql: item.sql.slice(0, 100),
            error: error instanceof Error ? error.message : String(error),
          });
          // Brief backoff before next drain cycle
          await new Promise((r) => setTimeout(r, 100 * (item.retries + 1)));
          // Re-schedule drain to process the re-enqueued item
          return;
        }
        logger.error('PG_WRITE_ERROR', error, { sql: item.sql.slice(0, 100), retries: item.retries, dropped: true });
      }
    }
  }

  private write(sql: string, params: unknown[] = []): void {
    if (this.writeQueue.length >= PostgresStorageAdapter.MAX_WRITE_QUEUE) {
      logger.warn('PG_WRITE_QUEUE_FULL', 'Dropping write — queue at capacity', { sql: sql.slice(0, 80) });
      return;
    }
    this.writeQueue.push({ sql, params, retries: 0 });
    this.scheduleWriteDrain();
  }

  /** Build the HydrationContext snapshot used by the extracted hydration helpers. */
  private hydrationCtx(): HydrationContext {
    const ctx: HydrationContext = {
      pool: this.pool,
      cache: this.cache,
      hydratedSessions: this.hydratedSessions,
      lazyHydrate: this.lazyHydrate,
      crewFromRow: (row) => this.crewFromRow(row),
      writeQueue: this.writeQueue,
      drainPromise: this.drainPromise,
      scheduleWriteDrain: () => this.scheduleWriteDrain(),
    };
    Object.defineProperty(ctx, 'drainPromise', {
      get: () => this.drainPromise,
      enumerable: true,
      configurable: true,
    });
    return ctx;
  }

  /** Build the CheckpointContext snapshot used by the extracted checkpoint helpers. */
  private checkpointCtx(): CheckpointContext {
    return {
      cache: this.cache,
      flushWriteQueue: () => this.flushWriteQueue(),
      getMessages: (sessionId) => this.getMessages(sessionId),
      write: (sql, params) => this.write(sql, params),
      getCheckpoint: (sessionId, checkpointId) => this.getCheckpoint(sessionId, checkpointId),
      deleteMessages: (sessionId) => this.deleteMessages(sessionId),
      insertMessage: (msg) => this.insertMessage(msg),
      hydrateMessageCache: (sessionId) => this.hydrateMessageCache(sessionId),
    };
  }

  /** Build the MigrationContext snapshot used by the extracted migration helpers. */
  private migrationCtx(): MigrationContext {
    return {
      pool: this.pool,
      progress: (line) => this.progress(line),
      crewFromRow: (row) => this.crewFromRow(row),
      seedDefaultPersona: () => this.seedDefaultPersona(),
      hydrateEssentialCache: () => this.hydrateEssentialCache(),
      hydrateCache: () => this.hydrateCache(),
      lazyHydrate: this.lazyHydrate,
      setConnected: (value) => { this.connected = value; },
    };
  }

  /** Build the MessageContext snapshot used by the extracted message helpers. */
  private messageCtx(): MessageContext {
    return {
      pool: this.pool,
      cache: this.cache,
      write: (sql, params) => this.write(sql, params),
    };
  }

  /** Build the TokenLogContext snapshot used by the extracted token-log helpers. */
  private tokenLogCtx(): TokenLogContext {
    return {
      pool: this.pool,
      cache: this.cache,
      write: (sql, params) => this.write(sql, params),
    };
  }

  /** Build the ResumeStateContext snapshot used by the extracted resume-state helpers. */
  private resumeStateCtx(): ResumeStateContext {
    return {
      cache: this.cache,
      write: (sql, params) => this.write(sql, params),
    };
  }

  /** Build the CrewContext snapshot used by the extracted crew CRUD helpers. */
  private crewCtx(): CrewContext {
    return {
      cache: this.cache,
      write: (sql, params) => this.write(sql, params),
    };
  }

  /** Build the SessionExtrasContext snapshot used by the extracted session-extras helpers. */
  private sessionExtrasCtx(): SessionExtrasContext {
    return {
      cache: this.cache,
      write: (sql, params) => this.write(sql, params),
    };
  }

  private async hydrateEssentialCache(): Promise<void> {
    await hydrateEssentialCache(this.hydrationCtx());
  }

  /** Load messages and per-session data on first access (lazy cache). */
  async ensureSessionHydrated(sessionId: string): Promise<void> {
    await ensureSessionHydrated(this.hydrationCtx(), sessionId);
  }

  private async hydrateCache(): Promise<void> {
    await hydrateCache(this.hydrationCtx());
  }

  async flushWriteQueue(): Promise<void> {
    await flushWriteQueue(this.hydrationCtx());
  }

  private async hydrateMessageCache(sessionId: string): Promise<void> {
    await hydrateMessageCache(this.hydrationCtx(), sessionId);
  }

  // ─── Session CRUD ──────────────────────────────────────────────

  createSession(input: Omit<StorableSession, keyof RecordMeta>): StorableSession {
    const inputAny = input as Record<string, unknown>;
    const id = (inputAny['id'] as string) ?? generateId();
    const now = new Date().toISOString();
    const session: StorableSession = {
      id, ...input,
      parentId: (inputAny['parentId'] as string) ?? null,
      contextKind: (inputAny['contextKind'] as StorableSession['contextKind']) ?? 'agent_x',
      hostCrewId: (inputAny['hostCrewId'] as string | null) ?? null,
      hostCrewName: (inputAny['hostCrewName'] as string | null) ?? null,
      hostCrewCallsign: (inputAny['hostCrewCallsign'] as string | null) ?? null,
      hostCrewTitle: (inputAny['hostCrewTitle'] as string | null) ?? null,
      hostCrewColor: (inputAny['hostCrewColor'] as string | null) ?? null,
      hostCrewCatalogId: (inputAny['hostCrewCatalogId'] as string | null) ?? null,
      hostCrewCategoryId: (inputAny['hostCrewCategoryId'] as string | null) ?? null,
      createdAt: now, updatedAt: now,
    };
    this.cache.sessions.set(id, session);
    this.write(
      `INSERT INTO sessions (id,title,status,provider_id,model_id,scope_path,parent_id,token_used,token_available,context_kind,host_crew_id,host_crew_name,host_crew_callsign,host_crew_title,host_crew_color,host_crew_catalog_id,host_crew_category_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         provider_id = EXCLUDED.provider_id,
         model_id = EXCLUDED.model_id,
         scope_path = EXCLUDED.scope_path,
         parent_id = EXCLUDED.parent_id,
         token_available = EXCLUDED.token_available,
         context_kind = EXCLUDED.context_kind,
         host_crew_id = EXCLUDED.host_crew_id,
         host_crew_name = EXCLUDED.host_crew_name,
         host_crew_callsign = EXCLUDED.host_crew_callsign,
         host_crew_title = EXCLUDED.host_crew_title,
         host_crew_color = EXCLUDED.host_crew_color,
         host_crew_catalog_id = EXCLUDED.host_crew_catalog_id,
         host_crew_category_id = EXCLUDED.host_crew_category_id,
         updated_at = NOW()`,
      [id, input.title, input.status, input.providerId, input.modelId, input.scopePath,
       session.parentId, input.tokenUsed, input.tokenAvailable,
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
      parentId: 'parent_id',
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
    if (fields.length === 0) return;
    fields.push('updated_at = NOW()');
    values.push(id);
    this.write(`UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }

  private collectDescendantSessionIds(rootId: string): string[] {
    return collectDescendantSessionIds(this.hydrationCtx(), rootId);
  }

  private purgeSessionCache(id: string): void {
    purgeSessionCache(this.hydrationCtx(), id);
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

  getSessionListKpis(sessionId: string, base?: Session | Record<string, unknown>): SessionListKpis {
    const messageCount = this.getMessageCount(sessionId);
    const childSessionCount = this.listChildSessions(sessionId).length;
    const states = this.getCrewStates(sessionId);
    const crewCallsigns = states
      .filter((s) => s['enabled'] !== 0 && s['enabled'] !== false)
      .map((s) => String(s['crew_id'] ?? s['crewId'] ?? ''))
      .filter(Boolean);
    const logs = this.getTokenLogs(sessionId) as unknown as Array<Record<string, unknown>>;
    const totalCostUsd = logs.reduce((sum, l) => sum + (Number(l['costUsd'] ?? l['cost_usd']) || 0), 0);
    const cached = this.cache.sessions.get(sessionId);
    const baseRecord = base && 'compactionCount' in base ? (base as Record<string, unknown>) : undefined;
    let compactionCount = Number(baseRecord?.['compactionCount'] ?? cached?.compactionCount ?? 0);
    if (compactionCount === 0) {
      const msgs = this.getMessages(sessionId);
      compactionCount = msgs.filter((m) => m.content.includes('[COMPACTION SUMMARY')).length;
    }
    const tokensUsed = Number(base?.['tokenUsed'] ?? cached?.tokenUsed ?? 0);
    const tokenAvailable = Number(base?.['tokenAvailable'] ?? cached?.tokenAvailable ?? 128_000);
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

  addMessage(sessionId: string, message: StorableMessageInput): StorableMessage {
    return addMessageImpl(this.messageCtx(), sessionId, message);
  }

  getMessages(sessionId: string): StorableMessage[] {
    return getMessagesImpl(this.messageCtx(), sessionId);
  }

  deleteMessages(sessionId: string): void {
    deleteMessagesImpl(this.messageCtx(), sessionId);
  }

  /**
   * Hard-delete all session content: messages, parts, checkpoints, feedback, resume
   * state, and related artifacts. The session row itself is preserved.
   */
  purgeSessionContent(sessionId: string): void {
    purgeSessionContentImpl(this.messageCtx(), sessionId, (id, updates) => this.updateSession(id, updates));
  }

  /**
   * Soft-archive all messages in a session: hidden from UI/history reads but
   * kept in the DB so memory ingestion/backfill and audits are unaffected.
   */
  archiveSessionMessages(sessionId: string): void {
    archiveSessionMessagesImpl(this.messageCtx(), sessionId);
  }

  getMessageCount(sessionId: string): number {
    return getMessageCountImpl(this.messageCtx(), sessionId);
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
    attachments?: unknown;
    createdAt?: string;
    platformMessageId?: number | null;
    platformMessageIds?: number[] | null;
    platformChatId?: number | null;
  }): void {
    insertMessageImpl(this.messageCtx(), msg);
  }

  updateMessage(sessionId: string, messageId: string, patch: {
    content?: string;
    parts?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    attachments?: unknown;
    platformMessageId?: number | null;
    platformMessageIds?: number[] | null;
    platformChatId?: number | null;
  }): void {
    updateMessageImpl(this.messageCtx(), sessionId, messageId, patch);
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
    insertPartImpl(this.messageCtx(), sessionId, part);
  }

  getParts(sessionId: string): Array<Record<string, unknown>> {
    return getPartsImpl(this.messageCtx(), sessionId);
  }

  async getPartsForMessages(
    sessionId: string,
    messages: Array<Record<string, unknown> | StorableMessage>,
  ): Promise<Array<Record<string, unknown>>> {
    return getPartsForMessagesImpl(this.messageCtx(), sessionId, messages);
  }

  deleteLastMessages(sessionId: string, count: number, roles: string[]): void {
    deleteLastMessages(this.checkpointCtx(), sessionId, count, roles);
  }

  createCheckpoint(sessionId: string, label: string): { id: string } | null {
    return createCheckpoint(this.checkpointCtx(), sessionId, label);
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
    return restoreCheckpoint(this.checkpointCtx(), sessionId, checkpointId);
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
    saveTaskSnapshotImpl(this.sessionExtrasCtx(), snapshot);
  }

  getTaskSnapshot(sessionId: string): Record<string, unknown> | null {
    return getTaskSnapshotImpl(this.sessionExtrasCtx(), sessionId);
  }

  deleteTaskSnapshot(sessionId: string): void {
    deleteTaskSnapshotImpl(this.sessionExtrasCtx(), sessionId);
  }

  // ─── Token Logs ────────────────────────────────────────────────

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void {
    addTokenLogImpl(this.tokenLogCtx(), sessionId, log);
  }

  getTokenLogs(sessionId: string): StorableTokenLog[] {
    return getTokenLogsImpl(this.tokenLogCtx(), sessionId);
  }

  async getTokenLogsAsync(sessionId: string): Promise<StorableTokenLog[]> {
    return getTokenLogsAsyncImpl(this.tokenLogCtx(), sessionId);
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
    addToolExecutionImpl(this.sessionExtrasCtx(), exec);
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
    addPermissionRuleImpl(this.sessionExtrasCtx(), rule);
  }

  clearPermissionRules(sessionId: string): void {
    clearPermissionRulesImpl(this.sessionExtrasCtx(), sessionId);
  }

  getPermissionRules(sessionId: string): Array<Record<string, unknown>> {
    return getPermissionRulesImpl(this.sessionExtrasCtx(), sessionId);
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
    saveCrewStateImpl(this.sessionExtrasCtx(), state);
  }

  getCrewStates(sessionId: string): Array<Record<string, unknown>> {
    return getCrewStatesImpl(this.sessionExtrasCtx(), sessionId);
  }

  loadCrewStates(sessionId: string): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
    return loadCrewStatesImpl(this.sessionExtrasCtx(), sessionId);
  }

  // ─── Session Events ────────────────────────────────────────────

  insertSessionEvent(event: SessionEvent): void {
    insertSessionEventImpl(this.sessionExtrasCtx(), event);
  }

  getSessionEvents(sessionId: string, sinceSequence?: number): SessionEvent[] {
    return getSessionEventsImpl(this.sessionExtrasCtx(), sessionId, sinceSequence);
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
    addCrewFeedbackImpl(this.sessionExtrasCtx(), feedback);
  }

  getCrewFeedback(crewId: string): Array<Record<string, unknown>> {
    return getCrewFeedbackImpl(this.sessionExtrasCtx(), crewId);
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
    upsertTurnFeedbackImpl(this.sessionExtrasCtx(), feedback);
  }

  getTurnFeedbackBySession(sessionId: string): Array<Record<string, unknown>> {
    return getTurnFeedbackBySessionImpl(this.sessionExtrasCtx(), sessionId);
  }

  setSessionResumeState(sessionId: string, state: {
    kind: string;
    messageId: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): void {
    setSessionResumeStateImpl(this.resumeStateCtx(), sessionId, state);
  }

  getSessionResumeState(sessionId: string): Record<string, unknown> | null {
    return getSessionResumeStateImpl(this.resumeStateCtx(), sessionId);
  }

  clearSessionResumeState(sessionId: string): void {
    clearSessionResumeStateImpl(this.resumeStateCtx(), sessionId);
  }

  async getMessagesPage(
    sessionId: string,
    opts: { limit?: number; before?: string },
  ): Promise<{ messages: Array<Record<string, unknown>>; total: number; hasMore: boolean }> {
    return getMessagesPageImpl(this.messageCtx(), sessionId, opts);
  }

  // ─── Crew CRUD ─────────────────────────────────────────────────

  listCrews(): Crew[] {
    return listCrewsImpl(this.crewCtx());
  }

  getCrew(id: string): Crew | undefined {
    return getCrewImpl(this.crewCtx(), id);
  }

  getDefaultCrew(): Crew | undefined {
    return getDefaultCrewImpl(this.crewCtx());
  }

  createCrew(input: CrewCreateInput): Crew {
    return createCrewImpl(this.crewCtx(), input);
  }

  updateCrew(id: string, updates: Partial<Crew>): Crew | null {
    return updateCrewImpl(this.crewCtx(), id, updates);
  }

  deleteCrew(id: string): void {
    deleteCrewImpl(this.crewCtx(), id);
  }

  // ─── Agent Persona ────────────────────────────────────────────

  getPersona(): AgentPersonaConfig | null {
    return this.cache.persona;
  }

  setPersona(persona: AgentPersonaConfig): void {
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
