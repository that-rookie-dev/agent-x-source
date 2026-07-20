import type { StorableMessage } from '@agentx/shared';
import type { CacheState } from './pg-helpers.js';

/** Input shape accepted by `insertMessage`. */
export interface InsertMessageInput {
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
}

/**
 * Context required by the checkpoint helpers. Mirrors the relevant private
 * state/methods of PostgresStorageAdapter so the extracted functions can
 * operate without `this`.
 */
export interface CheckpointContext {
  cache: CacheState;
  flushWriteQueue: () => Promise<void>;
  getMessages: (sessionId: string) => StorableMessage[];
  write: (sql: string, params?: unknown[]) => void;
  getCheckpoint: (sessionId: string, checkpointId: string) => Array<Record<string, unknown>> | null;
  deleteMessages: (sessionId: string) => void;
  insertMessage: (msg: InsertMessageInput) => void;
  hydrateMessageCache: (sessionId: string) => Promise<void>;
}

export function deleteLastMessages(
  ctx: CheckpointContext,
  sessionId: string,
  count: number,
  roles: string[],
): void {
  const placeholders = roles.map((_, i) => `$${i + 2}`).join(',');
  ctx.write(
    `DELETE FROM messages WHERE id IN (
      SELECT id FROM messages
      WHERE session_id = $1 AND role IN (${placeholders})
      ORDER BY created_at DESC
      LIMIT $${roles.length + 2}
    )`,
    [sessionId, ...roles, count]
  );
  ctx.cache.messages.delete(sessionId);
  ctx.hydrateMessageCache(sessionId).catch(() => {});
}

export function createCheckpoint(
  ctx: CheckpointContext,
  sessionId: string,
  label: string,
): { id: string } | null {
  // Best-effort: kick a drain so recent inserts are less likely to be missing from cache/PG.
  void ctx.flushWriteQueue();
  const msgs = ctx.getMessages(sessionId);
  if (!msgs || msgs.length === 0) return null;
  const id = crypto.randomUUID();
  const messagesJson = JSON.stringify(msgs);

  ctx.write(
    `DELETE FROM checkpoints WHERE id IN (
      SELECT id FROM checkpoints WHERE session_id = $1
      ORDER BY created_at ASC
      LIMIT GREATEST(0, (SELECT COUNT(*) FROM checkpoints WHERE session_id = $1) - 19)
    )`,
    [sessionId]
  );

  ctx.write(
    `INSERT INTO checkpoints (id,session_id,label,messages,created_at) VALUES ($1,$2,$3,$4,NOW())`,
    [id, sessionId, label, messagesJson]
  );

  const arr = ctx.cache.checkpoints.get(sessionId) ?? [];
  if (arr.length >= 20) arr.shift();
  arr.push({ id, session_id: sessionId, label, messages: messagesJson, created_at: new Date().toISOString() });
  ctx.cache.checkpoints.set(sessionId, arr);

  return { id };
}

export function restoreCheckpoint(
  ctx: CheckpointContext,
  sessionId: string,
  checkpointId: string,
): boolean {
  const msgs = ctx.getCheckpoint(sessionId, checkpointId);
  if (!msgs) return false;
  ctx.deleteMessages(sessionId);
  for (const msg of msgs) {
    if (msg['role'] === 'part') continue;
    ctx.insertMessage({
      sessionId,
      role: msg['role'] as string || 'system',
      content: msg['content'] as string || '',
      toolCalls: msg['tool_calls'] as string || undefined,
      tokenCount: msg['token_count'] as number || undefined,
    });
  }
  return true;
}
