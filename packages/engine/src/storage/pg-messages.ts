import type { Pool } from 'pg';
import { generateId } from '@agentx/shared';
import type {
  StorableMessage,
  StorableMessageInput,
} from '@agentx/shared';
import type { CacheState } from './pg-helpers.js';

/**
 * Context required by the message storage helpers. Mirrors the relevant
 * private state/methods of PostgresStorageAdapter so the extracted functions
 * can operate without `this`.
 */
export interface MessageContext {
  pool: Pool;
  cache: CacheState;
  write: (sql: string, params?: unknown[]) => void;
}

export function addMessage(
  ctx: MessageContext,
  sessionId: string,
  message: StorableMessageInput,
): StorableMessage {
  const id = generateId();
  const now = new Date().toISOString();
  const msg: StorableMessage = { id, ...message, createdAt: now };
  const msgs = ctx.cache.messages.get(sessionId) ?? [];
  msgs.push(msg);
  ctx.cache.messages.set(sessionId, msgs);
  ctx.write(
    'INSERT INTO messages (id,session_id,role,content,tool_calls,token_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, sessionId, msg.role, msg.content, msg.toolCalls ?? null, msg.tokenCount, now]
  );
  return msg;
}

export function getMessages(
  ctx: MessageContext,
  sessionId: string,
): StorableMessage[] {
  return [...(ctx.cache.messages.get(sessionId) ?? [])];
}

export function deleteMessages(ctx: MessageContext, sessionId: string): void {
  ctx.cache.messages.delete(sessionId);
  ctx.cache.parts.delete(sessionId);
  ctx.write('DELETE FROM messages WHERE session_id = $1', [sessionId]);
}

export function getMessageCount(ctx: MessageContext, sessionId: string): number {
  return (ctx.cache.messages.get(sessionId) ?? []).length;
}

export function insertMessage(
  ctx: MessageContext,
  msg: {
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
    createdAt?: string;
  },
): void {
  const msgs = ctx.cache.messages.get(msg.sessionId) ?? [];
  const id = msg.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const existingIdx = msgs.findIndex((m) => m.id === id);
  const row = {
    id, sessionId: msg.sessionId, role: msg.role, content: msg.content,
    toolCalls: msg.toolCalls != null ? JSON.stringify(msg.toolCalls) : undefined,
    tokenCount: msg.tokenCount ?? 0, createdAt: msg.createdAt ?? now,
    parts: msg.parts,
    metadata: msg.metadata,
  };
  if (existingIdx >= 0) {
    const prev = msgs[existingIdx]!;
    msgs[existingIdx] = {
      ...prev,
      ...row,
      createdAt: prev.createdAt,
      parts: msg.parts ?? prev.parts,
      metadata: msg.metadata ?? prev.metadata,
    };
  } else {
    msgs.push(row);
  }
  ctx.cache.messages.set(msg.sessionId, msgs);
  ctx.write(
    `INSERT INTO messages (id,session_id,role,content,tool_calls,token_count,plan,parts,metadata,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (id) DO UPDATE SET
       content = EXCLUDED.content,
       tool_calls = COALESCE(EXCLUDED.tool_calls, messages.tool_calls),
       token_count = EXCLUDED.token_count,
       plan = COALESCE(EXCLUDED.plan, messages.plan),
       parts = COALESCE(EXCLUDED.parts, messages.parts),
       metadata = COALESCE(EXCLUDED.metadata, messages.metadata)`,
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

export function updateMessage(
  ctx: MessageContext,
  sessionId: string,
  messageId: string,
  patch: {
    content?: string;
    parts?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  },
): void {
  const msgs = ctx.cache.messages.get(sessionId) ?? [];
  const idx = msgs.findIndex((m) => m.id === messageId);
  if (idx >= 0) {
    const cur = msgs[idx]!;
    msgs[idx] = {
      ...cur,
      content: patch.content ?? cur.content,
      parts: patch.parts ?? cur.parts,
      metadata: patch.metadata ?? cur.metadata,
    };
    ctx.cache.messages.set(sessionId, msgs);
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (patch.content !== undefined) { sets.push(`content = $${n++}`); vals.push(patch.content); }
  if (patch.parts !== undefined) { sets.push(`parts = $${n++}`); vals.push(JSON.stringify(patch.parts)); }
  if (patch.metadata !== undefined) { sets.push(`metadata = $${n++}`); vals.push(JSON.stringify(patch.metadata)); }
  if (sets.length === 0) return;
  vals.push(messageId, sessionId);
  ctx.write(`UPDATE messages SET ${sets.join(', ')} WHERE id = $${n} AND session_id = $${n + 1}`, vals);
}

export function insertPart(
  ctx: MessageContext,
  sessionId: string,
  part: {
    type: string;
    messageId?: string;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    toolSuccess?: boolean;
    usage?: { inputTokens: number; outputTokens: number };
  },
): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const messageId = part.messageId ?? null;
  const cached = ctx.cache.parts.get(sessionId) ?? [];
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
  ctx.cache.parts.set(sessionId, cached);
  ctx.write(
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

export function getParts(
  ctx: MessageContext,
  sessionId: string,
): Array<Record<string, unknown>> {
  return ctx.cache.parts.get(sessionId) ?? [];
}

export async function getPartsForMessages(
  ctx: MessageContext,
  sessionId: string,
  messages: Array<Record<string, unknown> | StorableMessage>,
): Promise<Array<Record<string, unknown>>> {
  if (messages.length === 0) return [];
  const messageIds = messages.map((m) => m['id'] as string).filter((id): id is string => !!id);
  if (messageIds.length === 0) return [];
  const times = messages
    .map((m) => ((m['created_at'] as string) ?? (m['createdAt'] as string)))
    .filter((t): t is string => !!t);
  const min = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
  const max = times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
  const result = await ctx.pool.query(
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

export function purgeSessionContent(
  ctx: MessageContext,
  sessionId: string,
  updateSession: (sessionId: string, updates: { tokenUsed: number; compactionCount: number }) => void,
): void {
  ctx.cache.messages.set(sessionId, []);
  ctx.cache.parts.set(sessionId, []);
  ctx.cache.checkpoints.set(sessionId, []);
  ctx.cache.turnFeedback.delete(sessionId);
  ctx.cache.taskSnapshots.delete(sessionId);
  ctx.cache.tokenLogs.delete(sessionId);
  ctx.cache.sessionEvents.delete(sessionId);
  ctx.write('DELETE FROM message_parts WHERE session_id = $1', [sessionId]);
  ctx.write('DELETE FROM messages WHERE session_id = $1', [sessionId]);
  ctx.write('DELETE FROM checkpoints WHERE session_id = $1', [sessionId]);
  ctx.write('DELETE FROM turn_feedback WHERE session_id = $1', [sessionId]);
  ctx.write('DELETE FROM session_resume_state WHERE session_id = $1', [sessionId]);
  ctx.write('DELETE FROM task_snapshots WHERE session_id = $1', [sessionId]);
  ctx.write('DELETE FROM token_logs WHERE session_id = $1', [sessionId]);
  ctx.write("DELETE FROM session_events WHERE session_id = $1", [sessionId]);
  updateSession(sessionId, { tokenUsed: 0, compactionCount: 0 });
}

export function archiveSessionMessages(ctx: MessageContext, sessionId: string): void {
  ctx.cache.messages.set(sessionId, []);
  ctx.cache.parts.set(sessionId, []);
  ctx.write('UPDATE messages SET archived_at = NOW() WHERE session_id = $1 AND archived_at IS NULL', [sessionId]);
}

export async function getMessagesPage(
  ctx: MessageContext,
  sessionId: string,
  opts: { limit?: number; before?: string },
): Promise<{ messages: Array<Record<string, unknown>>; total: number; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const result = await ctx.pool.query(
    `SELECT id, session_id as "sessionId", role, content, tool_calls as "toolCalls",
            token_count as "tokenCount", parts, metadata, created_at as "createdAt"
     FROM messages
     WHERE session_id = $1
       AND role IN ('user', 'assistant')
       AND archived_at IS NULL
       AND ($2::text IS NULL OR created_at < (SELECT created_at FROM messages WHERE id = $2 AND session_id = $1))
     ORDER BY created_at DESC
     LIMIT $3`,
    [sessionId, opts.before ?? null, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const totalResult = await ctx.pool.query(
    `SELECT COUNT(*)::int as cnt FROM messages WHERE session_id = $1 AND role IN ('user', 'assistant') AND archived_at IS NULL`,
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
