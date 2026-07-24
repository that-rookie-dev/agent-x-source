/**
 * Document Studio — Job persistence (spec §14).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ArtifactRef, Job, JobSpec, JobStatus, Manifest } from '../types.js';

export class JobStore {
  constructor(private readonly pool: Pool) {}

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: String(row['id']),
      title: String(row['title']),
      status: String(row['status']) as JobStatus,
      spec: (row['spec'] as JobSpec) ?? { version: 1, intent: '', inputs: [], steps: [], policies: { missingRequired: 'ask', missingOptional: 'blank', inventFacts: false, citations: 'off', pii: 'allow', overwrite: 'fail', partialBatch: 'allow' } },
      recipeId: row['recipe_id'] != null ? String(row['recipe_id']) : undefined,
      binderId: row['binder_id'] != null ? String(row['binder_id']) : undefined,
      progress: {
        done: Number(row['progress_done'] ?? 0),
        total: Number(row['progress_total'] ?? 0),
        detail: row['progress_detail'] != null ? String(row['progress_detail']) : undefined,
      },
      artifacts: (row['artifacts'] as ArtifactRef[]) ?? [],
      manifestId: row['manifest_id'] != null ? String(row['manifest_id']) : undefined,
      stepResults: (row['step_results'] as Record<string, unknown>) ?? undefined,
      error: row['error'] != null ? String(row['error']) : undefined,
      cancelled: row['cancelled'] === true,
      cancelledAt: row['cancelled_at'] instanceof Date ? row['cancelled_at'].toISOString() : (row['cancelled_at'] ? String(row['cancelled_at']) : undefined),
      createdAt: row['created_at'] instanceof Date ? row['created_at'].toISOString() : String(row['created_at']),
      updatedAt: row['updated_at'] instanceof Date ? row['updated_at'].toISOString() : String(row['updated_at'] ?? row['created_at']),
    };
  }

  async create(title: string, spec: JobSpec, recipeId?: string, binderId?: string): Promise<Job> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO doc_jobs (id, title, status, spec, recipe_id, binder_id) VALUES ($1, $2, 'draft', $3::jsonb, $4, $5) RETURNING *`,
      [id, title, JSON.stringify(spec), recipeId ?? null, binderId ?? null],
    );
    if (!rows[0]) throw new Error('Failed to create job');
    return this.rowToJob(rows[0]);
  }

  async get(id: string): Promise<Job | null> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_jobs WHERE id = $1`, [id]);
    return rows[0] ? this.rowToJob(rows[0]) : null;
  }

  async list(filter?: { status?: JobStatus; limit?: number }): Promise<Job[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filter?.status) { values.push(filter.status); where.push(`status = $${values.length}`); }
    const sql = `SELECT * FROM doc_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ${Math.max(1, Math.min(100, filter?.limit ?? 50))}`;
    const { rows } = await this.pool.query(sql, values);
    return rows.map((r) => this.rowToJob(r));
  }

  async update(id: string, patch: Partial<Job>): Promise<Job | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.title !== undefined) { sets.push(`title = $${n++}`); values.push(patch.title); }
    if (patch.status !== undefined) { sets.push(`status = $${n++}`); values.push(patch.status); }
    if (patch.spec !== undefined) { sets.push(`spec = $${n++}::jsonb`); values.push(JSON.stringify(patch.spec)); }
    if (patch.recipeId !== undefined) { sets.push(`recipe_id = $${n++}`); values.push(patch.recipeId ?? null); }
    if (patch.binderId !== undefined) { sets.push(`binder_id = $${n++}`); values.push(patch.binderId ?? null); }
    if (patch.progress !== undefined) { sets.push(`progress_done = $${n++}, progress_total = $${n++}, progress_detail = $${n++}`); values.push(patch.progress.done, patch.progress.total, patch.progress.detail ?? null); }
    if (patch.artifacts !== undefined) { sets.push(`artifacts = $${n++}::jsonb`); values.push(JSON.stringify(patch.artifacts)); }
    if (patch.manifestId !== undefined) { sets.push(`manifest_id = $${n++}`); values.push(patch.manifestId ?? null); }
    if (patch.stepResults !== undefined) { sets.push(`step_results = $${n++}::jsonb`); values.push(JSON.stringify(patch.stepResults)); }
    if (patch.error !== undefined) { sets.push(`error = $${n++}`); values.push(patch.error ?? null); }
    if (patch.cancelled !== undefined) { sets.push(`cancelled = $${n++}`); values.push(patch.cancelled); }
    if (patch.cancelledAt !== undefined) { sets.push(`cancelled_at = $${n++}`); values.push(patch.cancelledAt); }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE doc_jobs SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      values,
    );
    return rows[0] ? this.rowToJob(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM doc_jobs WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}

export class ManifestStore {
  constructor(private readonly pool: Pool) {}

  private rowToManifest(row: Record<string, unknown>): Manifest {
    return {
      id: String(row['id']),
      jobId: String(row['job_id']),
      rows: (row['rows'] as Manifest['rows']) ?? [],
      summary: {
        ok: Number(row['summary_ok'] ?? 0),
        failed: Number(row['summary_failed'] ?? 0),
        skipped: Number(row['summary_skipped'] ?? 0),
      },
    };
  }

  async create(jobId: string, rows: Manifest['rows'] = [], summary?: Manifest['summary']): Promise<Manifest> {
    const id = randomUUID();
    const s = summary ?? { ok: 0, failed: 0, skipped: 0 };
    const { rows: out } = await this.pool.query(
      `INSERT INTO doc_manifests (id, job_id, rows, summary_ok, summary_failed, summary_skipped) VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
      [id, jobId, JSON.stringify(rows), s.ok, s.failed, s.skipped],
    );
    if (!out[0]) throw new Error('Failed to create manifest');
    return this.rowToManifest(out[0]);
  }

  async get(id: string): Promise<Manifest | null> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_manifests WHERE id = $1`, [id]);
    return rows[0] ? this.rowToManifest(rows[0]) : null;
  }
}
