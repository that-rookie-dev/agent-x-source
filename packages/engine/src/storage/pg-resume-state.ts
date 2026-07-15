import type { CacheState } from './pg-helpers.js';

/**
 * Context required by the session-resume-state helpers. Mirrors the relevant
 * private state/methods of PostgresStorageAdapter so the extracted functions
 * can operate without `this`.
 */
export interface ResumeStateContext {
  cache: CacheState;
  write: (sql: string, params?: unknown[]) => void;
}

export function setSessionResumeState(
  ctx: ResumeStateContext,
  sessionId: string,
  state: {
    kind: string;
    messageId: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  },
): void {
  const createdAt = state.createdAt ?? new Date().toISOString();
  const entry = {
    session_id: sessionId,
    kind: state.kind,
    message_id: state.messageId,
    payload: JSON.stringify(state.payload),
    created_at: createdAt,
  };
  ctx.cache.resumeState.set(sessionId, entry);
  ctx.write(
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

export function getSessionResumeState(
  ctx: ResumeStateContext,
  sessionId: string,
): Record<string, unknown> | null {
  return ctx.cache.resumeState.get(sessionId) ?? null;
}

export function clearSessionResumeState(
  ctx: ResumeStateContext,
  sessionId: string,
): void {
  ctx.cache.resumeState.delete(sessionId);
  ctx.write('DELETE FROM session_resume_state WHERE session_id = $1', [sessionId]);
}
