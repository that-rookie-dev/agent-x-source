import type { Pool } from 'pg';
import type { CacheState } from './pg-helpers.js';

export interface VoiceRealtimeStateRecord {
  sessionId: string;
  xaiConversationId: string | null;
  xaiConversationUpdatedAt: string | null;
  lastVoiceActiveAt: string | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
  summarySourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceRealtimeContext {
  pool: Pool;
  cache: CacheState;
  write: (sql: string, params?: unknown[]) => void;
}

function rowToRecord(row: Record<string, unknown>): VoiceRealtimeStateRecord {
  return {
    sessionId: String(row['session_id'] ?? ''),
    xaiConversationId: row['xai_conversation_id'] != null ? String(row['xai_conversation_id']) : null,
    xaiConversationUpdatedAt: row['xai_conversation_updated_at'] != null
      ? new Date(String(row['xai_conversation_updated_at'])).toISOString()
      : null,
    lastVoiceActiveAt: row['last_voice_active_at'] != null
      ? new Date(String(row['last_voice_active_at'])).toISOString()
      : null,
    summary: row['summary'] != null ? String(row['summary']) : null,
    summaryUpdatedAt: row['summary_updated_at'] != null
      ? new Date(String(row['summary_updated_at'])).toISOString()
      : null,
    summarySourceMessageId: row['summary_source_message_id'] != null
      ? String(row['summary_source_message_id'])
      : null,
    createdAt: new Date(String(row['created_at'] ?? Date.now())).toISOString(),
    updatedAt: new Date(String(row['updated_at'] ?? Date.now())).toISOString(),
  };
}

export async function getVoiceRealtimeState(
  ctx: VoiceRealtimeContext,
  sessionId: string,
): Promise<VoiceRealtimeStateRecord | null> {
  const cached = ctx.cache.voiceRealtime.get(sessionId);
  if (cached) return cached;

  try {
    const result = await ctx.pool.query(
      `SELECT session_id, xai_conversation_id, xai_conversation_updated_at,
              last_voice_active_at, summary, summary_updated_at, summary_source_message_id,
              created_at, updated_at
       FROM voice_realtime_state WHERE session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const record = rowToRecord(row);
    ctx.cache.voiceRealtime.set(sessionId, record);
    return record;
  } catch {
    return null;
  }
}

export type VoiceRealtimeStatePatch = {
  xaiConversationId?: string | null;
  xaiConversationUpdatedAt?: string | null;
  lastVoiceActiveAt?: string | null;
  summary?: string | null;
  summaryUpdatedAt?: string | null;
  summarySourceMessageId?: string | null;
  /** When true, never overwrite an existing non-null xai_conversation_id. */
  preserveExistingConversationId?: boolean;
};

/**
 * Merge patch onto the durable row. Always hydrates from DB on cache miss so a
 * partial touch (e.g. last_voice_active_at only) cannot wipe summary fields.
 */
export async function upsertVoiceRealtimeState(
  ctx: VoiceRealtimeContext,
  sessionId: string,
  patch: VoiceRealtimeStatePatch,
): Promise<VoiceRealtimeStateRecord> {
  const now = new Date().toISOString();
  const prev = await getVoiceRealtimeState(ctx, sessionId);
  const preserveId = patch.preserveExistingConversationId !== false;

  let nextConversationId = patch.xaiConversationId !== undefined
    ? patch.xaiConversationId
    : (prev?.xaiConversationId ?? null);
  if (preserveId && prev?.xaiConversationId) {
    nextConversationId = prev.xaiConversationId;
  }

  const next: VoiceRealtimeStateRecord = {
    sessionId,
    xaiConversationId: nextConversationId,
    xaiConversationUpdatedAt: patch.xaiConversationUpdatedAt !== undefined
      ? patch.xaiConversationUpdatedAt
      : (prev?.xaiConversationUpdatedAt ?? null),
    lastVoiceActiveAt: patch.lastVoiceActiveAt !== undefined
      ? patch.lastVoiceActiveAt
      : (prev?.lastVoiceActiveAt ?? null),
    summary: patch.summary !== undefined ? patch.summary : (prev?.summary ?? null),
    summaryUpdatedAt: patch.summaryUpdatedAt !== undefined
      ? patch.summaryUpdatedAt
      : (prev?.summaryUpdatedAt ?? null),
    summarySourceMessageId: patch.summarySourceMessageId !== undefined
      ? patch.summarySourceMessageId
      : (prev?.summarySourceMessageId ?? null),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };

  if (!prev?.xaiConversationId && next.xaiConversationId && !next.xaiConversationUpdatedAt) {
    next.xaiConversationUpdatedAt = now;
  }

  ctx.cache.voiceRealtime.set(sessionId, next);
  // COALESCE guards a race where another writer has fields we didn't load yet.
  ctx.write(
    `INSERT INTO voice_realtime_state (
       session_id, xai_conversation_id, xai_conversation_updated_at,
       last_voice_active_at, summary, summary_updated_at, summary_source_message_id,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id) DO UPDATE SET
       xai_conversation_id = CASE
         WHEN voice_realtime_state.xai_conversation_id IS NOT NULL
           AND voice_realtime_state.xai_conversation_id <> ''
         THEN voice_realtime_state.xai_conversation_id
         ELSE EXCLUDED.xai_conversation_id
       END,
       xai_conversation_updated_at = CASE
         WHEN voice_realtime_state.xai_conversation_id IS NOT NULL
           AND voice_realtime_state.xai_conversation_id <> ''
         THEN voice_realtime_state.xai_conversation_updated_at
         ELSE COALESCE(EXCLUDED.xai_conversation_updated_at, voice_realtime_state.xai_conversation_updated_at)
       END,
       last_voice_active_at = COALESCE(EXCLUDED.last_voice_active_at, voice_realtime_state.last_voice_active_at),
       summary = COALESCE(EXCLUDED.summary, voice_realtime_state.summary),
       summary_updated_at = COALESCE(EXCLUDED.summary_updated_at, voice_realtime_state.summary_updated_at),
       summary_source_message_id = COALESCE(EXCLUDED.summary_source_message_id, voice_realtime_state.summary_source_message_id),
       updated_at = EXCLUDED.updated_at`,
    [
      next.sessionId,
      next.xaiConversationId,
      next.xaiConversationUpdatedAt,
      next.lastVoiceActiveAt,
      next.summary,
      next.summaryUpdatedAt,
      next.summarySourceMessageId,
      next.createdAt,
      next.updatedAt,
    ],
  );
  return next;
}

export async function touchVoiceRealtimeActive(
  ctx: VoiceRealtimeContext,
  sessionId: string,
  at: string = new Date().toISOString(),
): Promise<void> {
  await upsertVoiceRealtimeState(ctx, sessionId, {
    lastVoiceActiveAt: at,
    preserveExistingConversationId: true,
  });
}
