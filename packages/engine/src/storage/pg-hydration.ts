import type { Pool } from 'pg';
import type {
  StorableSession,
  StorableMessage,
  StorableTokenLog,
} from '@agentx/shared';
import type { SessionEvent, Crew, AgentPersonaConfig } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { CacheState } from './pg-helpers.js';

const logger = getLogger();

/**
 * Context required by the hydration helpers. Mirrors the private state of
 * PostgresStorageAdapter so the extracted functions can operate without `this`.
 */
export interface HydrationContext {
  pool: Pool;
  cache: CacheState;
  hydratedSessions: Set<string>;
  lazyHydrate: boolean;
  crewFromRow: (row: Record<string, unknown>) => Crew;
  writeQueue: Array<{ sql: string; params: unknown[]; retries: number }>;
  drainPromise: Promise<void> | null;
  scheduleWriteDrain: () => void;
}

export async function hydrateEssentialCache(ctx: HydrationContext): Promise<void> {
  try {
    const sessions = await ctx.pool.query(
      `SELECT id,title,status,provider_id as "providerId",model_id as "modelId",
              scope_path as "scopePath",token_used as "tokenUsed",token_available as "tokenAvailable",
              compaction_count as "compactionCount",
              context_kind as "contextKind",host_crew_id as "hostCrewId",
              host_crew_name as "hostCrewName",host_crew_callsign as "hostCrewCallsign",
              host_crew_title as "hostCrewTitle",host_crew_color as "hostCrewColor",
              host_crew_catalog_id as "hostCrewCatalogId",host_crew_category_id as "hostCrewCategoryId",
              parent_id as "parentId",created_at as "createdAt",updated_at as "updatedAt"
       FROM sessions`,
    );
    for (const row of sessions.rows) {
      ctx.cache.sessions.set((row as StorableSession).id, row as StorableSession);
    }

    const childSessions = await ctx.pool.query(
      'SELECT id, parent_session_id, kind, label, status, created_at, updated_at FROM child_sessions ORDER BY created_at ASC',
    );
    for (const row of childSessions.rows) {
      const r = row as Record<string, unknown>;
      const parentId = r['parent_session_id'] as string;
      const arr = ctx.cache.childSessions.get(parentId) ?? [];
      arr.push({
        id: r['id'],
        parentSessionId: parentId,
        kind: r['kind'],
        label: r['label'],
        status: r['status'],
        createdAt: r['created_at'],
        updatedAt: r['updated_at'],
      });
      ctx.cache.childSessions.set(parentId, arr);
    }

    const crews = await ctx.pool.query('SELECT * FROM crews ORDER BY created_at ASC');
    ctx.cache.crews = crews.rows.map((row: Record<string, unknown>) => ctx.crewFromRow(row));

    const persona = await ctx.pool.query('SELECT * FROM agent_persona LIMIT 1');
    if (persona.rows[0]) {
      const p = persona.rows[0] as Record<string, unknown>;
      ctx.cache.persona = {
        name: p['name'] as string,
        description: p['description'] as string,
        communicationStyle: p['communication_style'] as string,
        decisionMaking: p['decision_making'] as string,
        domainContext: p['domain_context'] as string,
        traits: (() => { try { return JSON.parse((p['traits'] as string) || '[]') as string[]; } catch (error) { logger.warn('PG_STORAGE', `Failed to parse persona traits: ${error instanceof Error ? error.message : String(error)}`); return []; } })(),
      } as AgentPersonaConfig;
    }

    logger.info('PG_HYDRATE', `Essential cache loaded (${ctx.cache.sessions.size} sessions, lazy message load enabled)`);
  } catch (error) {
    logger.error('PG_HYDRATE_FAILED', error);
  }
}

/** Load messages and per-session data on first access (lazy cache). */
export async function ensureSessionHydrated(ctx: HydrationContext, sessionId: string): Promise<void> {
  if (!ctx.lazyHydrate || ctx.hydratedSessions.has(sessionId)) return;
  await hydrateMessageCache(ctx, sessionId);
  ctx.hydratedSessions.add(sessionId);
}

export async function hydrateCache(ctx: HydrationContext): Promise<void> {
  try {
    const sessions = await ctx.pool.query(
      `SELECT id,title,status,provider_id as "providerId",model_id as "modelId",
              scope_path as "scopePath",token_used as "tokenUsed",token_available as "tokenAvailable",
              compaction_count as "compactionCount",
              context_kind as "contextKind",host_crew_id as "hostCrewId",
              host_crew_name as "hostCrewName",host_crew_callsign as "hostCrewCallsign",
              host_crew_title as "hostCrewTitle",host_crew_color as "hostCrewColor",
              host_crew_catalog_id as "hostCrewCatalogId",host_crew_category_id as "hostCrewCategoryId",
              parent_id as "parentId",created_at as "createdAt",updated_at as "updatedAt"
       FROM sessions`,
    );
    for (const row of sessions.rows) {
      ctx.cache.sessions.set((row as StorableSession).id, row as StorableSession);
    }

    const childSessions = await ctx.pool.query(
      'SELECT id, parent_session_id, kind, label, status, created_at, updated_at FROM child_sessions ORDER BY created_at ASC',
    );
    for (const row of childSessions.rows) {
      const r = row as Record<string, unknown>;
      const parentId = r['parent_session_id'] as string;
      const arr = ctx.cache.childSessions.get(parentId) ?? [];
      arr.push({
        id: r['id'],
        parentSessionId: parentId,
        kind: r['kind'],
        label: r['label'],
        status: r['status'],
        createdAt: r['created_at'],
        updatedAt: r['updated_at'],
      });
      ctx.cache.childSessions.set(parentId, arr);
    }

    const messages = await ctx.pool.query(
      `SELECT id,session_id as "sessionId",role,content,tool_calls as "toolCalls",
              token_count as "tokenCount",parts,metadata,created_at as "createdAt",
              platform_message_id as "platformMessageId",
              platform_message_ids as "platformMessageIds",
              platform_chat_id as "platformChatId"
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
      // Parse platform_message_ids JSON array if present
      let platformMessageIds = raw['platformMessageIds'];
      if (typeof platformMessageIds === 'string') {
        try { platformMessageIds = JSON.parse(platformMessageIds); } catch { platformMessageIds = null; }
      }
      const msg = { ...raw, parts, metadata, platformMessageIds: platformMessageIds ?? null } as StorableMessage;
      const msgs = ctx.cache.messages.get(msg.sessionId) ?? [];
      msgs.push(msg);
      ctx.cache.messages.set(msg.sessionId, msgs);
    }
    const checkpoints = await ctx.pool.query('SELECT id, session_id, label, messages, created_at FROM checkpoints ORDER BY created_at ASC');
    for (const row of checkpoints.rows) {
      const r = row as { id: string; session_id: string; label: string; messages: string; created_at: string };
      const arr = ctx.cache.checkpoints.get(r.session_id) ?? [];
      arr.push(r);
      ctx.cache.checkpoints.set(r.session_id, arr);
    }
    const crews = await ctx.pool.query('SELECT * FROM crews ORDER BY created_at ASC');
    ctx.cache.crews = crews.rows.map((row: Record<string, unknown>) => ctx.crewFromRow(row));
    const crewStates = await ctx.pool.query('SELECT * FROM session_crew_states ORDER BY created_at ASC');
    for (const row of crewStates.rows) {
      const r = row as Record<string, unknown>;
      const sid = r['session_id'] as string;
      const arr = ctx.cache.crewStates.get(sid) ?? [];
      arr.push(r);
      ctx.cache.crewStates.set(sid, arr);
    }
    const sessionEvents = await ctx.pool.query("SELECT * FROM session_events WHERE event_type <> 'text_delta' ORDER BY sequence ASC");
    for (const row of sessionEvents.rows) {
      const r = row as Record<string, unknown>;
      const sid = r['session_id'] as string;
      const arr = ctx.cache.sessionEvents.get(sid) ?? [];
      arr.push({
        id: r['id'] as string,
        sessionId: sid,
        sequence: r['sequence'] as number,
        type: r['event_type'] as string,
        timestamp: r['created_at'] ? new Date(r['created_at'] as string).getTime() : Date.now(),
        payload: (() => { try { return JSON.parse(r['payload'] as string); } catch { return {}; } })(),
      } as unknown as SessionEvent);
      ctx.cache.sessionEvents.set(sid, arr);
    }
    const tokenLogs = await ctx.pool.query('SELECT id,session_id as "sessionId",provider_id,model_id as "model",input_tokens as "inputTokens",output_tokens as "outputTokens",cost_usd as "costUsd",crew_id as "crewId",created_at as "createdAt" FROM token_logs ORDER BY created_at ASC');
    for (const row of tokenLogs.rows) {
      const r = row as StorableTokenLog;
      const arr = ctx.cache.tokenLogs.get(r.sessionId) ?? [];
      arr.push(r);
      ctx.cache.tokenLogs.set(r.sessionId, arr);
    }
    const crewFeedback = await ctx.pool.query('SELECT * FROM crew_feedback ORDER BY created_at ASC');
    for (const row of crewFeedback.rows) {
      const r = row as Record<string, unknown>;
      const cid = r['crew_id'] as string;
      const arr = ctx.cache.crewFeedback.get(cid) ?? [];
      arr.push(r);
      ctx.cache.crewFeedback.set(cid, arr);
    }
    const turnFeedback = await ctx.pool.query('SELECT * FROM turn_feedback ORDER BY created_at ASC');
    for (const row of turnFeedback.rows) {
      const r = row as Record<string, unknown>;
      const sid = r['session_id'] as string;
      const arr = ctx.cache.turnFeedback.get(sid) ?? [];
      arr.push(r);
      ctx.cache.turnFeedback.set(sid, arr);
    }
    const resumeStates = await ctx.pool.query('SELECT * FROM session_resume_state');
    for (const row of resumeStates.rows) {
      const r = row as Record<string, unknown>;
      const sid = r['session_id'] as string;
      ctx.cache.resumeState.set(sid, r);
    }
    const permissionRules = await ctx.pool.query('SELECT * FROM permission_rules ORDER BY created_at ASC');
    for (const row of permissionRules.rows) {
      const r = row as Record<string, unknown>;
      const sid = r['session_id'] as string;
      const arr = ctx.cache.permissionRules.get(sid) ?? [];
      arr.push(r);
      ctx.cache.permissionRules.set(sid, arr);
    }
    const taskSnapshots = await ctx.pool.query(
      `SELECT DISTINCT ON (session_id) id, session_id, task_id, step_index, goal, plan_state, failure_history, created_at
       FROM task_snapshots ORDER BY session_id, created_at DESC`,
    );
    for (const row of taskSnapshots.rows) {
      const r = row as Record<string, unknown>;
      ctx.cache.taskSnapshots.set(r['session_id'] as string, r);
    }
    const personaId = '00000000-0000-0000-0000-000000000001';
    const persona = await ctx.pool.query('SELECT * FROM agent_persona WHERE id = $1', [personaId]);
    if (persona.rows.length > 0) {
      const r = persona.rows[0] as Record<string, unknown>;
      ctx.cache.persona = {
        name: (r['name'] as string) ?? '',
        description: (r['description'] as string) ?? '',
        communicationStyle: (r['communication_style'] as string) ?? 'direct',
        decisionMaking: (r['decision_making'] as string) ?? 'balanced',
        domainContext: (r['domain_context'] as string) ?? '',
        traits: (() => { try { return JSON.parse((r['traits'] as string) ?? '[]') as string[]; } catch (error) { logger.warn('PG_STORAGE', `Failed to parse persona traits: ${error instanceof Error ? error.message : String(error)}`); return []; } })(),
      } as AgentPersonaConfig;
    }
  } catch (error) {
    logger.error('PG_HYDRATE_FAILED', error);
  }
}

export async function flushWriteQueue(ctx: HydrationContext): Promise<void> {
  // Drain until idle so hydrate/checkpoint never race ahead of pending INSERTs.
  for (let i = 0; i < 20; i++) {
    if (ctx.writeQueue.length === 0 && !ctx.drainPromise) return;
    ctx.scheduleWriteDrain();
    if (ctx.drainPromise) await ctx.drainPromise;
  }
}

export async function hydrateMessageCache(ctx: HydrationContext, sessionId: string): Promise<void> {
  try {
    await flushWriteQueue(ctx);
    const messages = await ctx.pool.query(
      `SELECT id,session_id as "sessionId",role,content,tool_calls as "toolCalls",token_count as "tokenCount",created_at as "createdAt"
       FROM messages WHERE session_id = $1 AND archived_at IS NULL ORDER BY created_at ASC`,
      [sessionId]
    );
    const msgs = messages.rows as StorableMessage[];
    ctx.cache.messages.set(sessionId, msgs);
    const parts = await ctx.pool.query(
      'SELECT * FROM message_parts WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    );
    ctx.cache.parts.set(sessionId, parts.rows as Array<Record<string, unknown>>);
    const ckpts = await ctx.pool.query(
      'SELECT id, session_id, label, messages, created_at FROM checkpoints WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    );
    ctx.cache.checkpoints.set(sessionId, ckpts.rows as Array<{ id: string; session_id: string; label: string; messages: string; created_at: string }>);
  } catch { /* best effort */ }
}

export function collectDescendantSessionIds(ctx: HydrationContext, rootId: string): string[] {
  const out: string[] = [];
  const visit = (parentId: string) => {
    for (const s of ctx.cache.sessions.values()) {
      if (s.parentId === parentId) {
        out.push(s.id);
        visit(s.id);
      }
    }
  };
  visit(rootId);
  return out;
}

export function purgeSessionCache(ctx: HydrationContext, id: string): void {
  ctx.cache.sessions.delete(id);
  for (const [parentId, children] of ctx.cache.childSessions.entries()) {
    const filtered = children.filter((c) => c['id'] !== id);
    if (filtered.length === 0) ctx.cache.childSessions.delete(parentId);
    else ctx.cache.childSessions.set(parentId, filtered);
  }
  ctx.cache.messages.delete(id);
  ctx.cache.parts.delete(id);
  ctx.cache.checkpoints.delete(id);
  ctx.cache.crewStates.delete(id);
  ctx.cache.sessionEvents.delete(id);
  ctx.cache.tokenLogs.delete(id);
  ctx.cache.permissionRules.delete(id);
  ctx.cache.taskSnapshots.delete(id);
  ctx.cache.turnFeedback.delete(id);
}
