/**
 * Document Studio — Binder persistence (spec §5.4).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Binder, BinderSlot } from '../types.js';

export interface CreateBinderInput {
  name: string;
  description?: string;
  slots?: BinderSlot[];
}

export class BinderStore {
  constructor(private readonly pool: Pool) {}

  private rowToBinder(row: Record<string, unknown>): Binder {
    return {
      id: String(row['id']),
      name: String(row['name']),
      description: row['description'] != null ? String(row['description']) : undefined,
      slots: Array.isArray(row['slots']) ? (row['slots'] as BinderSlot[]) : [],
      createdAt: row['created_at'] instanceof Date ? row['created_at'].toISOString() : String(row['created_at']),
      updatedAt: row['updated_at'] instanceof Date ? row['updated_at'].toISOString() : String(row['updated_at'] ?? row['created_at']),
    };
  }

  async insert(input: CreateBinderInput): Promise<Binder> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO doc_binders (id, name, description, slots) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
      [id, input.name, input.description ?? null, JSON.stringify(input.slots ?? [])],
    );
    if (!rows[0]) throw new Error('Failed to create binder');
    return this.rowToBinder(rows[0]);
  }

  async list(query?: string): Promise<Binder[]> {
    const sql = query
      ? `SELECT * FROM doc_binders WHERE name ILIKE $1 ORDER BY updated_at DESC`
      : `SELECT * FROM doc_binders ORDER BY updated_at DESC`;
    const { rows } = await this.pool.query(sql, query ? [`%${query}%`] : []);
    return rows.map((r) => this.rowToBinder(r));
  }

  async get(id: string): Promise<Binder | null> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_binders WHERE id = $1`, [id]);
    return rows[0] ? this.rowToBinder(rows[0]) : null;
  }

  async update(id: string, patch: Partial<CreateBinderInput>): Promise<Binder | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.name !== undefined) { sets.push(`name = $${n++}`); values.push(patch.name); }
    if ('description' in patch) { sets.push(`description = $${n++}`); values.push(patch.description ?? null); }
    if (patch.slots !== undefined) { sets.push(`slots = $${n++}::jsonb`); values.push(JSON.stringify(patch.slots)); }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE doc_binders SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      values,
    );
    return rows[0] ? this.rowToBinder(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM doc_binders WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}
