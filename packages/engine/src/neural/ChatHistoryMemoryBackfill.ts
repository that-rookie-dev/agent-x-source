/**
 * One-shot backfill: embed historical user/assistant pairs from persisted sessions
 * into chat_memory nodes so memory_search works for conversations before ingestion shipped.
 */
import type { Pool } from 'pg';
import type { EmbeddingProvider, SessionContextKind } from '@agentx/shared';
import { getLogger, resolveMemoryFabricWriteSessionId } from '@agentx/shared';
import type { MemoryFabric } from './MemoryFabric.js';
import { ChatTurnMemoryIngester } from './ChatTurnMemoryIngester.js';

export async function backfillChatMemoryFromSessions(
  pool: Pool,
  fabric: MemoryFabric,
  embedder: EmbeddingProvider,
  options?: { maxSessions?: number; maxTurns?: number },
): Promise<number> {
  const maxSessions = options?.maxSessions ?? 40;
  const maxTurns = options?.maxTurns ?? 200;
  const ingester = new ChatTurnMemoryIngester(fabric, embedder);
  let queued = 0;

  try {
    const { rows: sessions } = await pool.query<{ id: string; context_kind: string | null }>(
      `SELECT id, context_kind FROM sessions ORDER BY updated_at DESC LIMIT $1`,
      [maxSessions],
    );

    for (const { id: sessionId, context_kind: contextKind } of sessions) {
      if (queued >= maxTurns) break;
      const storageSessionId = resolveMemoryFabricWriteSessionId(
        sessionId,
        (contextKind ?? 'agent_x') as SessionContextKind,
      );
      const { rows: msgs } = await pool.query<{ role: string; content: string }>(
        `SELECT role, content FROM messages
         WHERE session_id = $1 AND role IN ('user', 'assistant')
         ORDER BY created_at ASC`,
        [sessionId],
      );

      let pendingUser: string | null = null;
      for (const m of msgs) {
        if (queued >= maxTurns) break;
        if (m.role === 'user') {
          pendingUser = m.content;
        } else if (m.role === 'assistant' && pendingUser) {
          const ok = await ingester.ingestTurn(pendingUser, m.content, sessionId, storageSessionId);
          if (ok) queued++;
          pendingUser = null;
        }
      }
    }

    if (queued > 0) {
      getLogger().info('CHAT_MEMORY', `Backfill queued ${queued} historical turns for embedding`);
    }
    return queued;
  } catch (e) {
    getLogger().warn('CHAT_MEMORY', `Backfill failed: ${e instanceof Error ? e.message : String(e)}`);
    return queued;
  }
}
