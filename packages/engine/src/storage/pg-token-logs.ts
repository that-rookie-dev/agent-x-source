import type { Pool } from 'pg';
import { generateId } from '@agentx/shared';
import type { StorableTokenLog } from '@agentx/shared';
import type { CacheState } from './pg-helpers.js';

/**
 * Context required by the token-log helpers. Mirrors the relevant private
 * state/methods of PostgresStorageAdapter so the extracted functions can
 * operate without `this`.
 */
export interface TokenLogContext {
  pool: Pool;
  cache: CacheState;
  write: (sql: string, params?: unknown[]) => void;
}

export function addTokenLog(
  ctx: TokenLogContext,
  sessionId: string,
  log: Omit<StorableTokenLog, 'id' | 'createdAt'>,
): void {
  const id = generateId();
  const now = new Date().toISOString();
  const entry: StorableTokenLog = {
    id,
    sessionId,
    model: log.model,
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    providerId: log.providerId,
    costUsd: log.costUsd ?? null,
    crewId: log.crewId ?? null,
    reasoningTokens: log.reasoningTokens ?? 0,
    createdAt: now,
  };
  const arr = ctx.cache.tokenLogs.get(sessionId) ?? [];
  arr.push(entry);
  ctx.cache.tokenLogs.set(sessionId, arr);
  ctx.write(
    `INSERT INTO token_logs (id,session_id,provider_id,model_id,input_tokens,output_tokens,reasoning_tokens,cost_usd,crew_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id, sessionId, log.providerId || 'unknown',
      log.model,
      log.inputTokens, log.outputTokens,
      log.reasoningTokens ?? 0,
      log.costUsd ?? null,
      log.crewId ?? null,
    ]
  );
}

export function getTokenLogs(
  ctx: TokenLogContext,
  sessionId: string,
): StorableTokenLog[] {
  return ctx.cache.tokenLogs.get(sessionId) ?? [];
}

export async function getTokenLogsAsync(
  ctx: TokenLogContext,
  sessionId: string,
): Promise<StorableTokenLog[]> {
  try {
    const result = await ctx.pool.query(
      `SELECT id,session_id as "sessionId",provider_id,model_id as "model",input_tokens as "inputTokens",output_tokens as "outputTokens",created_at as "createdAt"
       FROM token_logs WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );
    return result.rows as StorableTokenLog[];
  } catch { return []; }
}
