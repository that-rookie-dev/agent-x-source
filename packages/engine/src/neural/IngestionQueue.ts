/**
 * Database-backed ingestion job queue.
 *
 * Uses `FOR UPDATE SKIP LOCKED` so multiple worker processes can safely claim
 * jobs without double-processing. No Redis/BullMQ — everything lives in
 * PostgreSQL.
 */
import type { Pool } from 'pg';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobKind = 'web_distill' | 'document_ingest' | 're_extract' | 'memory_consolidate' | 'louvain_layout' | 'rag_telemetry' | 'community_summarize';

/** Atomic stage detail persisted alongside job progress. */
export interface StageDetail {
  stage: string;
  detail?: string;
  chunkIndex?: number;
  chunkCount?: number;
  batchIndex?: number;
  batchCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** An append-only event in the ingestion event log. */
export interface IngestionEvent {
  id: number;
  jobId: string;
  stage: string;
  detail?: string;
  chunkIndex?: number;
  chunkCount?: number;
  batchIndex?: number;
  batchCount?: number;
  progress: number;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: Date;
}

export interface IngestionJob {
  id: string;
  kind: JobKind;
  payload: unknown;
  status: JobStatus;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  error?: string;
  progress: number;
  stageDetail?: StageDetail | null;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IngestionJobInput {
  kind: JobKind;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
}

export interface ClaimedJob {
  job: IngestionJob;
  complete(result?: unknown): Promise<void>;
  fail(error: string, retry?: boolean): Promise<void>;
  /** Persist the full atomic progress event (stage + detail + chunk counters). */
  setProgressEvent(progress: number, detail: StageDetail): Promise<void>;
}

export class IngestionQueue {
  constructor(private pool: Pool) {}

  async enqueue(input: IngestionJobInput): Promise<IngestionJob> {
    const { rows } = await this.pool.query<IngestionJob>(
      `INSERT INTO ingestion_jobs (kind, payload, status, priority, max_attempts)
       VALUES ($1, $2, 'pending', $3, $4)
       RETURNING id, kind, payload, status, priority, attempt_count AS "attemptCount", max_attempts AS "maxAttempts",
                error, progress, stage_detail AS "stageDetail", locked_until AS "lockedUntil", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [input.kind, JSON.stringify(input.payload ?? {}), input.priority ?? 0, input.maxAttempts ?? 3],
    );
    if (!rows[0]) throw new Error('Failed to enqueue ingestion job');
    return rows[0];
  }

  async claimNext(kinds: JobKind[], limit = 1): Promise<ClaimedJob[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<IngestionJob>(
        `SELECT id, kind, payload, status, priority, attempt_count AS "attemptCount", max_attempts AS "maxAttempts",
                error, progress, stage_detail AS "stageDetail", locked_until AS "lockedUntil", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM ingestion_jobs
         WHERE status = 'pending'
           AND kind = ANY ($1::text[])
           AND (locked_until IS NULL OR locked_until < NOW())
         ORDER BY priority DESC, created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [kinds, limit],
      );

      const claimed: ClaimedJob[] = [];
      for (const job of rows) {
        await client.query(
          `UPDATE ingestion_jobs SET status = 'running', attempt_count = attempt_count + 1, locked_until = NOW() + INTERVAL '5 minutes', updated_at = NOW() WHERE id = $1`,
          [job.id],
        );
        claimed.push({
          job,
          complete: async (result?: unknown) => {
            await this.pool.query(
              `UPDATE ingestion_jobs SET status = 'done', progress = 100, error = NULL, result = $1, updated_at = NOW() WHERE id = $2`,
              [JSON.stringify(result ?? {}), job.id],
            );
          },
          fail: async (error: string, retry = true) => {
            const maxAttempts = job.maxAttempts;
            if (retry && job.attemptCount + 1 < maxAttempts) {
              await this.pool.query(
                `UPDATE ingestion_jobs SET status = 'pending', error = $1, locked_until = NOW() + INTERVAL '1 minute', updated_at = NOW() WHERE id = $2`,
                [error, job.id],
              );
            } else {
              await this.pool.query(
                `UPDATE ingestion_jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
                [error, job.id],
              );
            }
          },
          setProgressEvent: async (progress: number, detail: StageDetail) => {
            const clamped = Math.max(0, Math.min(100, progress));
            const inTok = detail.inputTokens ?? 0;
            const outTok = detail.outputTokens ?? 0;
            // Insert into the append-only event log so the SSE stream can
            // deliver every atomic event without loss (the stage_detail column
            // only holds the latest state; this table holds the full history).
            await this.pool.query(
              `INSERT INTO ingestion_events (job_id, stage, detail, chunk_index, chunk_count, batch_index, batch_count, progress, input_tokens, output_tokens)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [job.id, detail.stage, detail.detail ?? null, detail.chunkIndex ?? null, detail.chunkCount ?? null, detail.batchIndex ?? null, detail.batchCount ?? null, clamped, inTok, outTok],
            );
            // Update the job's current state (latest snapshot) and accumulate tokens.
            await this.pool.query(
              `UPDATE ingestion_jobs SET progress = $1, stage_detail = $2, total_input_tokens = total_input_tokens + $3, total_output_tokens = total_output_tokens + $4, updated_at = NOW() WHERE id = $5`,
              [clamped, JSON.stringify(detail), inTok, outTok, job.id],
            );
          },
        });
      }
      await client.query('COMMIT');
      return claimed;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async getPendingCount(): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ingestion_jobs WHERE status = 'pending'`,
    );
    return rows[0]?.count ?? 0;
  }

  /** Check if a job of the given kind already exists in pending or running status. */
  async hasActiveJob(kind: JobKind): Promise<boolean> {
    const { rows } = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ingestion_jobs WHERE kind = $1 AND status IN ('pending', 'running')`,
      [kind],
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  async resetStalledJobs(olderThanMinutes = 10): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE ingestion_jobs
       SET status = 'pending', locked_until = NULL, updated_at = NOW()
       WHERE status = 'running' AND updated_at < NOW() - INTERVAL '${olderThanMinutes} minutes'`
    );
    return rowCount ?? 0;
  }

  async pruneCompletedJobs(olderThanDays = 7): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM ingestion_jobs WHERE status IN ('done', 'failed', 'cancelled') AND updated_at < NOW() - INTERVAL '${olderThanDays} days'`
    );
    return rowCount ?? 0;
  }

  /** Fetch a single job by ID. */
  async getJob(id: string): Promise<IngestionJob | null> {
    const { rows } = await this.pool.query<IngestionJob>(
      `SELECT id, kind, payload, status, priority, attempt_count AS "attemptCount", max_attempts AS "maxAttempts",
              error, progress, result, stage_detail AS "stageDetail",
              total_input_tokens AS "totalInputTokens", total_output_tokens AS "totalOutputTokens",
              locked_until AS "lockedUntil", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM ingestion_jobs WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** List recent jobs, optionally filtered by kind and/or status. */
  async getJobs(opts: { kind?: JobKind; status?: JobStatus; limit?: number } = {}): Promise<IngestionJob[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.kind) {
      params.push(opts.kind);
      conditions.push(`kind = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(opts.limit ?? 50);
    const { rows } = await this.pool.query<IngestionJob>(
      `SELECT id, kind, payload, status, priority, attempt_count AS "attemptCount", max_attempts AS "maxAttempts",
              error, progress, result, stage_detail AS "stageDetail",
              total_input_tokens AS "totalInputTokens", total_output_tokens AS "totalOutputTokens",
              locked_until AS "lockedUntil", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM ingestion_jobs ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  /** Fetch events after the given event id (cursor-based, for SSE streaming). */
  async getEventsSince(jobId: string, afterEventId: number, limit = 200): Promise<IngestionEvent[]> {
    const { rows } = await this.pool.query<IngestionEvent>(
      `SELECT id, job_id AS "jobId", stage, detail, chunk_index AS "chunkIndex", chunk_count AS "chunkCount",
              batch_index AS "batchIndex", batch_count AS "batchCount", progress,
              input_tokens AS "inputTokens", output_tokens AS "outputTokens", created_at AS "createdAt"
       FROM ingestion_events WHERE job_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`,
      [jobId, afterEventId, limit],
    );
    return rows;
  }

  /** Fetch the most recent N events for a job (for initial log population). */
  async getRecentEvents(jobId: string, limit = 200): Promise<IngestionEvent[]> {
    const { rows } = await this.pool.query<IngestionEvent>(
      `SELECT * FROM (
        SELECT id, job_id AS "jobId", stage, detail, chunk_index AS "chunkIndex", chunk_count AS "chunkCount",
               batch_index AS "batchIndex", batch_count AS "batchCount", progress,
               input_tokens AS "inputTokens", output_tokens AS "outputTokens", created_at AS "createdAt"
        FROM ingestion_events WHERE job_id = $1 ORDER BY id DESC LIMIT $2
      ) sub ORDER BY id ASC`,
      [jobId, limit],
    );
    return rows;
  }

  /** Cancel a job. If pending, marks as cancelled immediately. If running, marks
   *  as cancelled so the worker can detect it on the next chunk boundary. */
  async cancelJob(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE ingestion_jobs SET status = 'cancelled', locked_until = NULL, updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'running')`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Delete a job and all its events (CASCADE on ingestion_events handles cleanup). */
  async deleteJob(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM ingestion_jobs WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
