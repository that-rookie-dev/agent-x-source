/**
 * Document Studio — AnswerSet persistence (spec §5.5).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AnswerSet, Provenance } from '../types.js';

export class AnswerSetStore {
  constructor(private readonly pool: Pool) {}

  private rowToAnswerSet(row: Record<string, unknown>): AnswerSet {
    return {
      id: String(row['id']),
      values: (row['values'] as Record<string, unknown>) ?? {},
      provenance: (row['provenance'] as Record<string, Provenance>) ?? {},
      createdAt: row['created_at'] instanceof Date ? row['created_at'].toISOString() : String(row['created_at']),
      updatedAt: row['updated_at'] instanceof Date ? row['updated_at'].toISOString() : String(row['updated_at'] ?? row['created_at']),
    };
  }

  async create(values: Record<string, unknown> = {}, provenance: Record<string, Provenance> = {}): Promise<AnswerSet> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO doc_answer_sets (id, values, provenance) VALUES ($1, $2::jsonb, $3::jsonb) RETURNING *`,
      [id, JSON.stringify(values), JSON.stringify(provenance)],
    );
    if (!rows[0]) throw new Error('Failed to create answer set');
    return this.rowToAnswerSet(rows[0]);
  }

  async get(id: string): Promise<AnswerSet | null> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_answer_sets WHERE id = $1`, [id]);
    return rows[0] ? this.rowToAnswerSet(rows[0]) : null;
  }

  async update(id: string, patch: { values?: Record<string, unknown>; provenance?: Record<string, Provenance> }): Promise<AnswerSet | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.values !== undefined) { sets.push(`values = $${n++}::jsonb`); values.push(JSON.stringify(patch.values)); }
    if (patch.provenance !== undefined) { sets.push(`provenance = $${n++}::jsonb`); values.push(JSON.stringify(patch.provenance)); }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE doc_answer_sets SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      values,
    );
    return rows[0] ? this.rowToAnswerSet(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM doc_answer_sets WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}
