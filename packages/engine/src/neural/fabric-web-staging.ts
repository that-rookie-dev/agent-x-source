/**
 * Web staging helpers extracted from MemoryFabric (REFACTOR-5).
 *
 * Standalone functions for the web_staging table: staging raw payloads,
 * fetching pending rows, marking distillation/done, and expiring old rows.
 * The MemoryFabric class delegates to these to keep the main module focused.
 */
import type { Pool } from 'pg';

/** Context required by the web-staging helpers. */
export interface WebStagingContext {
  pool: Pool;
}

export async function stageWebPayload(
  ctx: WebStagingContext,
  url: string,
  domain: string,
  kind: string,
  rawPayload: unknown,
  sourceId?: string,
  ttlDays = 7,
): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO web_staging (url, domain, kind, raw_payload, status, source_id, expires_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, NOW() + $6::interval)
     ON CONFLICT (url, kind) DO UPDATE SET raw_payload = EXCLUDED.raw_payload, status = 'pending', updated_at = NOW(), expires_at = NOW() + $6::interval
     RETURNING id`,
    [url, domain, kind, JSON.stringify(rawPayload), sourceId ?? null, `${ttlDays} days`],
  );
  if (!rows[0]) throw new Error('Failed to stage web payload');
  return rows[0].id;
}

export async function getPendingWebStaging(
  ctx: WebStagingContext,
  limit = 10,
): Promise<Array<{ id: string; url: string; domain: string; kind: string; rawPayload: unknown }>> {
  const { rows } = await ctx.pool.query(
    `SELECT id, url, domain, kind, raw_payload AS "rawPayload"
     FROM web_staging
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function markWebStagingDistilled(
  ctx: WebStagingContext,
  id: string,
  distilledContent: string,
): Promise<void> {
  await ctx.pool.query(
    `UPDATE web_staging SET distilled_content = $1, status = 'distilled', updated_at = NOW() WHERE id = $2`,
    [distilledContent, id],
  );
}

export async function markWebStagingDone(ctx: WebStagingContext, id: string): Promise<void> {
  await ctx.pool.query(
    `UPDATE web_staging SET status = 'done', updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function cleanupExpiredWebStaging(ctx: WebStagingContext): Promise<{ deleted: number }> {
  const { rowCount } = await ctx.pool.query(
    `DELETE FROM web_staging WHERE expires_at IS NOT NULL AND expires_at < NOW()`
  );
  return { deleted: rowCount ?? 0 };
}
