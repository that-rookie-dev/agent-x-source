/**
 * Document Studio — Master persistence (doc_masters, spec §14).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AnalysisPackage, AnalysisState, Master, MasterFormat, MasterKind } from '../types.js';

const KINDS: MasterKind[] = ['layout', 'structure', 'standard', 'data', 'prior_artifact'];
const STATES: AnalysisState[] = ['pending', 'awaiting_model', 'analyzing', 'ready', 'partial', 'failed'];
const FORMATS: MasterFormat[] = ['docx', 'pdf', 'xlsx', 'pptx', 'csv', 'md', 'other'];

export interface CreateMasterInput {
  name: string;
  kind: MasterKind;
  format: MasterFormat;
  mimeType: string;
  storageId: string;
  checksum: string;
  tags?: string[];
}

export interface UpdateMasterInput {
  name?: string;
  kind?: MasterKind;
  tags?: string[];
  analysis?: AnalysisPackage | null;
  analysisState?: AnalysisState;
  analysisError?: string | null;
  storageId?: string;
  version?: number;
}

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? new Date().toISOString());
}

export class MasterStore {
  constructor(private readonly pool: Pool) {}

  private rowToMaster(row: Record<string, unknown>): Master {
    return {
      id: String(row['id']),
      name: String(row['name']),
      kind: KINDS.includes(row['kind'] as MasterKind) ? (row['kind'] as MasterKind) : 'layout',
      format: FORMATS.includes(row['format'] as MasterFormat) ? (row['format'] as MasterFormat) : 'other',
      mimeType: String(row['mime_type'] ?? 'application/octet-stream'),
      storageId: String(row['storage_id']),
      checksum: String(row['checksum'] ?? ''),
      version: Number(row['version'] ?? 1),
      analysis: (row['analysis'] as AnalysisPackage | null) ?? null,
      analysisState: STATES.includes(row['analysis_state'] as AnalysisState)
        ? (row['analysis_state'] as AnalysisState)
        : 'pending',
      analysisError: row['analysis_error'] != null ? String(row['analysis_error']) : null,
      tags: Array.isArray(row['tags']) ? (row['tags'] as string[]).map(String) : [],
      createdAt: toISO(row['created_at']),
      updatedAt: toISO(row['updated_at'] ?? row['created_at']),
    };
  }

  async insert(input: CreateMasterInput): Promise<Master> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO doc_masters (id, name, kind, format, mime_type, storage_id, checksum, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, input.name, input.kind, input.format, input.mimeType, input.storageId, input.checksum, input.tags ?? []],
    );
    if (!rows[0]) throw new Error('Failed to create master');
    return this.rowToMaster(rows[0]);
  }

  async list(filter?: { kind?: MasterKind; query?: string }): Promise<Master[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filter?.kind) {
      values.push(filter.kind);
      where.push(`kind = $${values.length}`);
    }
    if (filter?.query) {
      values.push(`%${filter.query}%`);
      where.push(`(name ILIKE $${values.length} OR $${values.length} = ANY(tags))`);
    }
    const sql = `SELECT * FROM doc_masters ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, name ASC`;
    const { rows } = await this.pool.query(sql, values);
    return rows.map((r) => this.rowToMaster(r));
  }

  async get(id: string): Promise<Master | null> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_masters WHERE id = $1`, [id]);
    return rows[0] ? this.rowToMaster(rows[0]) : null;
  }

  async update(id: string, patch: UpdateMasterInput): Promise<Master | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.name !== undefined) { sets.push(`name = $${n++}`); values.push(patch.name); }
    if (patch.kind !== undefined) { sets.push(`kind = $${n++}`); values.push(patch.kind); }
    if (patch.tags !== undefined) { sets.push(`tags = $${n++}`); values.push(patch.tags); }
    if ('analysis' in patch) { sets.push(`analysis = $${n++}::jsonb`); values.push(patch.analysis == null ? null : JSON.stringify(patch.analysis)); }
    if (patch.analysisState !== undefined) { sets.push(`analysis_state = $${n++}`); values.push(patch.analysisState); }
    if ('analysisError' in patch) { sets.push(`analysis_error = $${n++}`); values.push(patch.analysisError ?? null); }
    if (patch.storageId !== undefined) { sets.push(`storage_id = $${n++}`); values.push(patch.storageId); }
    if (patch.version !== undefined) { sets.push(`version = $${n++}`); values.push(patch.version); }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE doc_masters SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      values,
    );
    return rows[0] ? this.rowToMaster(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM doc_masters WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}
