import { generateId } from '@agentx/shared';
import type { SessionEvent } from '@agentx/shared';
import type { CacheState } from './pg-helpers.js';

/**
 * Context required by the session-extras helpers. Mirrors the relevant
 * private state/methods of PostgresStorageAdapter so the extracted functions
 * can operate without `this`.
 */
export interface SessionExtrasContext {
  cache: CacheState;
  write: (sql: string, params?: unknown[]) => void;
}

// ─── Task Snapshots ─────────────────────────────────────────────

export function saveTaskSnapshot(
  ctx: SessionExtrasContext,
  snapshot: {
    sessionId: string;
    taskId: string;
    stepIndex: number;
    goal: string;
    planState: string;
    failureHistory: string;
  },
): void {
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
  ctx.cache.taskSnapshots.set(snapshot.sessionId, row);
  ctx.write('DELETE FROM task_snapshots WHERE session_id = $1', [snapshot.sessionId]);
  ctx.write(
    `INSERT INTO task_snapshots (id, session_id, task_id, step_index, goal, plan_state, failure_history, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, snapshot.sessionId, snapshot.taskId, snapshot.stepIndex, snapshot.goal, snapshot.planState, snapshot.failureHistory, now],
  );
}

export function getTaskSnapshot(
  ctx: SessionExtrasContext,
  sessionId: string,
): Record<string, unknown> | null {
  return ctx.cache.taskSnapshots.get(sessionId) ?? null;
}

export function deleteTaskSnapshot(ctx: SessionExtrasContext, sessionId: string): void {
  ctx.cache.taskSnapshots.delete(sessionId);
  ctx.write('DELETE FROM task_snapshots WHERE session_id = $1', [sessionId]);
}

// ─── Tool Executions ────────────────────────────────────────────

export function addToolExecution(
  ctx: SessionExtrasContext,
  exec: {
    id: string;
    sessionId: string;
    agentTaskId?: string;
    toolName: string;
    input: string;
    output?: string;
    success?: boolean;
    elapsedMs?: number;
  },
): void {
  ctx.write(
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

// ─── Permission Rules ───────────────────────────────────────────

export function addPermissionRule(
  ctx: SessionExtrasContext,
  rule: {
    id: string;
    sessionId: string;
    action: string;
    pattern?: string;
    effect: string;
    comment?: string;
  },
): void {
  const entry: Record<string, unknown> = {
    id: rule.id, session_id: rule.sessionId, action: rule.action,
    pattern: rule.pattern ?? '*', effect: rule.effect,
    comment: rule.comment ?? null,
  };
  const arr = ctx.cache.permissionRules.get(rule.sessionId) ?? [];
  arr.push(entry);
  ctx.cache.permissionRules.set(rule.sessionId, arr);
  ctx.write(
    `INSERT INTO permission_rules (id,session_id,action,pattern,effect,comment)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [rule.id, rule.sessionId, rule.action, rule.pattern ?? '*', rule.effect, rule.comment ?? null]
  );
}

export function clearPermissionRules(ctx: SessionExtrasContext, sessionId: string): void {
  ctx.cache.permissionRules.delete(sessionId);
  ctx.write('DELETE FROM permission_rules WHERE session_id = $1', [sessionId]);
}

export function getPermissionRules(
  ctx: SessionExtrasContext,
  sessionId: string,
): Array<Record<string, unknown>> {
  return ctx.cache.permissionRules.get(sessionId) ?? [];
}

// ─── Crew States ────────────────────────────────────────────────

export function saveCrewState(
  ctx: SessionExtrasContext,
  state: {
    id: string;
    sessionId: string;
    crewId: string;
    enabled: boolean;
    lastActive?: string;
    messageCount?: number;
  },
): void {
  const now = new Date().toISOString();
  const arr = ctx.cache.crewStates.get(state.sessionId) ?? [];
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
  ctx.cache.crewStates.set(state.sessionId, arr);
  ctx.write(
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

export function getCrewStates(
  ctx: SessionExtrasContext,
  sessionId: string,
): Array<Record<string, unknown>> {
  return ctx.cache.crewStates.get(sessionId) ?? [];
}

export function loadCrewStates(
  ctx: SessionExtrasContext,
  sessionId: string,
): Array<{ crewId: string; enabled: boolean; lastActive?: string; messageCount?: number }> {
  const rows = ctx.cache.crewStates.get(sessionId) ?? [];
  return rows.map((row) => ({
    crewId: row['crew_id'] as string,
    enabled: (row['enabled'] as number) === 1,
    lastActive: row['last_active'] as string | undefined,
    messageCount: row['message_count'] as number | undefined,
  }));
}

// ─── Session Events ─────────────────────────────────────────────

export function insertSessionEvent(
  ctx: SessionExtrasContext,
  event: SessionEvent,
): void {
  const arr = ctx.cache.sessionEvents.get(event.sessionId) ?? [];
  arr.push(event);
  ctx.cache.sessionEvents.set(event.sessionId, arr);
  ctx.write(
    `INSERT INTO session_events (id,session_id,sequence,event_type,payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [crypto.randomUUID(), event.sessionId, event.sequence, event.type, JSON.stringify(event)]
  );
}

export function getSessionEvents(
  ctx: SessionExtrasContext,
  sessionId: string,
  sinceSequence?: number,
): SessionEvent[] {
  const events = ctx.cache.sessionEvents.get(sessionId) ?? [];
  if (sinceSequence != null) {
    return events.filter((e) => e.sequence >= sinceSequence);
  }
  return [...events];
}

// ─── Crew Feedback ──────────────────────────────────────────────

export function addCrewFeedback(
  ctx: SessionExtrasContext,
  feedback: {
    id: string;
    sessionId: string;
    crewId: string;
    positive: boolean;
    comment?: string | null;
    createdAt: string;
  },
): void {
  const entry: Record<string, unknown> = {
    id: feedback.id, session_id: feedback.sessionId, crew_id: feedback.crewId,
    positive: feedback.positive ? 1 : 0,
    comment: feedback.comment ?? null,
    created_at: feedback.createdAt,
  };
  const arr = ctx.cache.crewFeedback.get(feedback.crewId) ?? [];
  arr.push(entry);
  ctx.cache.crewFeedback.set(feedback.crewId, arr);
  ctx.write(
    `INSERT INTO crew_feedback (id,session_id,crew_id,positive,comment)
     VALUES ($1,$2,$3,$4,$5)`,
    [feedback.id, feedback.sessionId, feedback.crewId, feedback.positive ? 1 : 0, feedback.comment ?? null]
  );
}

export function getCrewFeedback(
  ctx: SessionExtrasContext,
  crewId: string,
): Array<Record<string, unknown>> {
  return ctx.cache.crewFeedback.get(crewId) ?? [];
}

// ─── Turn Feedback ──────────────────────────────────────────────

export function upsertTurnFeedback(
  ctx: SessionExtrasContext,
  feedback: {
    id: string;
    sessionId: string;
    messageId: string;
    contextKind: string;
    crewId?: string | null;
    rating: string;
    turnSummary?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
  },
): void {
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
  const arr = ctx.cache.turnFeedback.get(feedback.sessionId) ?? [];
  const idx = arr.findIndex((e) => e['message_id'] === feedback.messageId);
  if (idx >= 0) arr[idx] = entry;
  else arr.push(entry);
  ctx.cache.turnFeedback.set(feedback.sessionId, arr);
  ctx.write(
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

export function getTurnFeedbackBySession(
  ctx: SessionExtrasContext,
  sessionId: string,
): Array<Record<string, unknown>> {
  return ctx.cache.turnFeedback.get(sessionId) ?? [];
}
