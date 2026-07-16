import type { Pool } from 'pg';
import type {
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  BackgroundTaskResourceUsage,
  BackgroundTaskChannelContext,
} from './background-task-types.js';

export interface BackgroundTaskStoreContext {
  pool: Pool;
  /**
   * Enqueue a write to the same transactional queue as session/message writes.
   * This keeps background task persistence ordered with message inserts.
   */
  write(sql: string, params?: unknown[]): void;
}

export interface BackgroundTaskStore {
  upsert(record: BackgroundTaskRecord): Promise<void>;
  getById(id: string): Promise<BackgroundTaskRecord | undefined>;
  getBySession(
    parentSessionId: string,
    opts?: { status?: BackgroundTaskStatus; limit?: number },
  ): Promise<BackgroundTaskRecord[]>;
  getRunning(): Promise<BackgroundTaskRecord[]>;
  getAll(opts?: { limit?: number }): Promise<BackgroundTaskRecord[]>;
  /** Mark running/queued tasks older than `cutoff` as failed (e.g. after a crash). */
  markStaleAsFailed(cutoff: number, reason: string): Promise<number>;
  deleteBySession(parentSessionId: string): Promise<void>;
}

function resourceUsageToJson(resourceUsage?: BackgroundTaskResourceUsage): string | null {
  if (!resourceUsage) return null;
  return JSON.stringify(resourceUsage);
}

function resourceUsageFromJson(value: string | null | undefined): BackgroundTaskResourceUsage | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as BackgroundTaskResourceUsage;
  } catch {
    return undefined;
  }
}

export class PostgresBackgroundTaskStore implements BackgroundTaskStore {
  private ctx: BackgroundTaskStoreContext;

  constructor(ctx: BackgroundTaskStoreContext) {
    this.ctx = ctx;
  }

  async upsert(record: BackgroundTaskRecord): Promise<void> {
    const sql = `INSERT INTO background_tasks (
      id, parent_session_id, child_session_id, instruction, tools, timeout, status,
      result, error, resource_usage, channel_context, background, consumed,
      created_at, updated_at, completed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,to_timestamp($14/1000.0),to_timestamp($15/1000.0),$16)
    ON CONFLICT (id) DO UPDATE SET
      child_session_id = EXCLUDED.child_session_id,
      instruction = EXCLUDED.instruction,
      tools = EXCLUDED.tools,
      timeout = EXCLUDED.timeout,
      status = EXCLUDED.status,
      result = EXCLUDED.result,
      error = EXCLUDED.error,
      resource_usage = EXCLUDED.resource_usage,
      channel_context = EXCLUDED.channel_context,
      background = EXCLUDED.background,
      consumed = EXCLUDED.consumed,
      updated_at = EXCLUDED.updated_at,
      completed_at = EXCLUDED.completed_at`;

    const params = [
      record.id,
      record.parentSessionId,
      record.childSessionId ?? null,
      record.instruction,
      JSON.stringify(record.tools),
      record.timeout,
      record.status,
      record.result ?? null,
      record.error ?? null,
      resourceUsageToJson(record.resourceUsage),
      record.channelContext ? JSON.stringify(record.channelContext) : null,
      record.background,
      record.consumed,
      record.createdAt,
      record.updatedAt,
      record.endTime ? new Date(record.endTime).toISOString() : null,
    ];

    this.ctx.write(sql, params);
  }

  async getById(id: string): Promise<BackgroundTaskRecord | undefined> {
    const result = await this.ctx.pool.query<Record<string, unknown>>(
      'SELECT * FROM background_tasks WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) return undefined;
    return this.rowToRecord(result.rows[0]!);
  }

  async getBySession(
    parentSessionId: string,
    opts: { status?: BackgroundTaskStatus; limit?: number } = {},
  ): Promise<BackgroundTaskRecord[]> {
    const conditions = ['parent_session_id = $1'];
    const params: unknown[] = [parentSessionId];
    if (opts.status) {
      params.push(opts.status);
      conditions.push(`status = $${params.length}`);
    }
    const limit = opts.limit ? `LIMIT ${Math.max(1, opts.limit)}` : '';
    const result = await this.ctx.pool.query<Record<string, unknown>>(
      `SELECT * FROM background_tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC ${limit}`,
      params,
    );
    return result.rows.map((r) => this.rowToRecord(r));
  }

  async getRunning(): Promise<BackgroundTaskRecord[]> {
    const result = await this.ctx.pool.query<Record<string, unknown>>(
      "SELECT * FROM background_tasks WHERE status IN ('pending','queued','running') ORDER BY created_at DESC",
    );
    return result.rows.map((r) => this.rowToRecord(r));
  }

  async getAll(opts: { limit?: number } = {}): Promise<BackgroundTaskRecord[]> {
    const limit = opts.limit ? `LIMIT ${Math.max(1, opts.limit)}` : '';
    const result = await this.ctx.pool.query<Record<string, unknown>>(
      `SELECT * FROM background_tasks ORDER BY created_at DESC ${limit}`,
    );
    return result.rows.map((r) => this.rowToRecord(r));
  }

  async markStaleAsFailed(cutoff: number, reason: string): Promise<number> {
    const result = await this.ctx.pool.query(
      `UPDATE background_tasks
       SET status = 'failed', error = $1, completed_at = NOW(), updated_at = NOW()
       WHERE status IN ('pending','queued','running')
         AND created_at < to_timestamp($2/1000.0)`,
      [reason, cutoff],
    );
    return result.rowCount ?? 0;
  }

  async deleteBySession(parentSessionId: string): Promise<void> {
    await this.ctx.pool.query('DELETE FROM background_tasks WHERE parent_session_id = $1', [parentSessionId]);
  }

  private rowToRecord(row: Record<string, unknown>): BackgroundTaskRecord {
    const safeArray = (value: unknown): string[] => {
      if (!value) return [];
      try {
        return JSON.parse(value as string) as string[];
      } catch {
        return [];
      }
    };

    return {
      id: String(row['id']),
      parentSessionId: String(row['parent_session_id']),
      childSessionId: row['child_session_id'] ? String(row['child_session_id']) : undefined,
      instruction: String(row['instruction']),
      tools: safeArray(row['tools']),
      timeout: Number(row['timeout'] ?? 0),
      status: String(row['status']) as BackgroundTaskStatus,
      result: row['result'] ? String(row['result']) : undefined,
      error: row['error'] ? String(row['error']) : undefined,
      resourceUsage: resourceUsageFromJson(row['resource_usage'] as string | null | undefined),
      channelContext: row['channel_context']
        ? (JSON.parse(row['channel_context'] as string) as BackgroundTaskChannelContext)
        : undefined,
      background: Boolean(row['background']),
      consumed: Boolean(row['consumed']),
      startTime: row['created_at'] ? new Date(row['created_at'] as string).getTime() : undefined,
      endTime: row['completed_at'] ? new Date(row['completed_at'] as string).getTime() : undefined,
      createdAt: row['created_at'] ? new Date(row['created_at'] as string).getTime() : Date.now(),
      updatedAt: row['updated_at'] ? new Date(row['updated_at'] as string).getTime() : Date.now(),
    };
  }
}
