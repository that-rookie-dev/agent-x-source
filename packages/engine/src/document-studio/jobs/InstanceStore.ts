/**
 * Document Studio — instance plan persistence (spec §14).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { InstanceStatus } from '../types.js';

export interface Instance {
  id: string;
  jobId: string;
  index: number;
  bindingSetId?: string;
  path?: string;
  masterId?: string;
  status: InstanceStatus;
  error?: string;
}

export class InstanceStore {
  constructor(private readonly pool: Pool) {}

  private rowToInstance(row: Record<string, unknown>): Instance {
    return {
      id: String(row['id']),
      jobId: String(row['job_id']),
      index: Number(row['index']),
      bindingSetId: row['binding_set_id'] != null ? String(row['binding_set_id']) : undefined,
      path: row['path'] != null ? String(row['path']) : undefined,
      masterId: row['master_id'] != null ? String(row['master_id']) : undefined,
      status: String(row['status']) as InstanceStatus,
      error: row['error'] != null ? String(row['error']) : undefined,
    };
  }

  async create(
    jobId: string,
    index: number,
    input: Partial<Pick<Instance, 'bindingSetId' | 'path' | 'masterId' | 'status' | 'error'>> = {},
  ): Promise<Instance> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO doc_instances (id, job_id, index, binding_set_id, path, master_id, status, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, jobId, index, input.bindingSetId ?? null, input.path ?? null, input.masterId ?? null, input.status ?? 'planned', input.error ?? null],
    );
    if (!rows[0]) throw new Error('Failed to create instance');
    return this.rowToInstance(rows[0]);
  }

  async getByJob(jobId: string): Promise<Instance[]> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_instances WHERE job_id = $1 ORDER BY index ASC`, [jobId]);
    return rows.map((r) => this.rowToInstance(r));
  }

  async updateStatus(id: string, status: InstanceStatus, error?: string): Promise<Instance | null> {
    const { rows } = await this.pool.query(
      `UPDATE doc_instances SET status = $1, error = $2 WHERE id = $3 RETURNING *`,
      [status, error ?? null, id],
    );
    return rows[0] ? this.rowToInstance(rows[0]) : null;
  }
}
