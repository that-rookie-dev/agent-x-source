/**
 * Document Studio — Mapping persistence (spec §5.5).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CoercionPreview, Master, Mapping, MappingEntry } from '../types.js';

export interface CreateMappingInput {
  dataMasterId: string;
  schemaRef: string;
  entries?: MappingEntry[];
  confirmed?: boolean;
}

export class MappingStore {
  constructor(private readonly pool: Pool) {}

  private rowToMapping(row: Record<string, unknown>): Mapping {
    return {
      id: String(row['id']),
      dataMasterId: String(row['data_master_id']),
      schemaRef: String(row['schema_ref']),
      entries: Array.isArray(row['entries']) ? (row['entries'] as MappingEntry[]) : [],
      confirmed: row['confirmed'] === true || row['confirmed'] === 't' || row['confirmed'] === 1,
      version: Number(row['version'] ?? 1),
      createdAt: row['created_at'] instanceof Date ? row['created_at'].toISOString() : String(row['created_at']),
      updatedAt: row['updated_at'] instanceof Date ? row['updated_at'].toISOString() : String(row['updated_at'] ?? row['created_at']),
    };
  }

  async insert(input: CreateMappingInput): Promise<Mapping> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO doc_mappings (id, data_master_id, schema_ref, entries, confirmed) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *`,
      [id, input.dataMasterId, input.schemaRef, JSON.stringify(input.entries ?? []), input.confirmed ?? false],
    );
    if (!rows[0]) throw new Error('Failed to create mapping');
    return this.rowToMapping(rows[0]);
  }

  async get(id: string): Promise<Mapping | null> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_mappings WHERE id = $1`, [id]);
    return rows[0] ? this.rowToMapping(rows[0]) : null;
  }

  async update(id: string, patch: Partial<CreateMappingInput & { confirmed?: boolean; version?: number }>): Promise<Mapping | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.dataMasterId !== undefined) { sets.push(`data_master_id = $${n++}`); values.push(patch.dataMasterId); }
    if (patch.schemaRef !== undefined) { sets.push(`schema_ref = $${n++}`); values.push(patch.schemaRef); }
    if (patch.entries !== undefined) { sets.push(`entries = $${n++}::jsonb`); values.push(JSON.stringify(patch.entries)); }
    if (patch.confirmed !== undefined) { sets.push(`confirmed = $${n++}`); values.push(patch.confirmed); }
    if (patch.version !== undefined) { sets.push(`version = $${n++}`); values.push(patch.version); }
    if (sets.length === 0) return this.get(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE doc_mappings SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      values,
    );
    return rows[0] ? this.rowToMapping(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM doc_mappings WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}

// ─── Mapping coercion preview & validation helpers ───────────────────────────

export interface MappingValidation {
  coercionPreview: CoercionPreview[];
  warnings: string[];
}

function toStringValue(sample: unknown): string {
  return sample === undefined || sample === null ? '' : String(sample).trim();
}

function isNumericString(value: string): boolean {
  return value !== '' && !Number.isNaN(Number(value)) && !Number.isNaN(parseFloat(value));
}

function coercionError(fromType: string, toType: string, sample: unknown): string | undefined {
  if (toType === 'unmapped') return 'No target variable mapped';
  if (fromType === 'unknown') return 'Source column type unknown';
  if (toType === 'unknown') return 'Target variable not found';

  if (fromType === toType) return undefined;

  if (fromType === 'number' && (toType === 'string' || toType === 'richtext' || toType === 'enum' || toType === 'money')) {
    return undefined;
  }
  if (fromType === 'boolean' && (toType === 'string' || toType === 'richtext' || toType === 'enum')) {
    return undefined;
  }
  if (fromType === 'date' && (toType === 'string' || toType === 'richtext')) {
    return undefined;
  }
  if (fromType === 'boolean' && toType === 'number') {
    return undefined;
  }

  if (fromType === 'number' && toType === 'boolean') {
    const n = typeof sample === 'number' ? sample : Number(sample);
    return n === 0 || n === 1 ? undefined : 'Cannot coerce number to boolean unless 0 or 1';
  }
  if (fromType === 'number' && toType === 'date') {
    return 'Cannot coerce number to date without a format';
  }

  if (fromType === 'string') {
    const s = toStringValue(sample);
    if (toType === 'number' || toType === 'money') {
      return isNumericString(s) ? undefined : `Cannot coerce string to ${toType}: not numeric`;
    }
    if (toType === 'boolean') {
      const lower = s.toLowerCase();
      if (['true', 'false', '1', '0', 'yes', 'no', 'y', 'n'].includes(lower)) return undefined;
      return /^-?\d+(\.\d+)?$/.test(s) ? 'Numeric string cannot be coerced to boolean' : `Cannot coerce string to boolean: value not true/false`;
    }
    if (toType === 'date') {
      return s !== '' && !Number.isNaN(Date.parse(s)) ? undefined : `Cannot coerce string to date: not parseable`;
    }
  }

  return `Cannot coerce ${fromType} to ${toType}`;
}

export function buildCoercionPreview(mapping: Mapping, dataMaster: Master, layoutMaster: Master): CoercionPreview[] {
  const columns = dataMaster.analysis?.dataProfile?.columns ?? [];
  const sampleRows = dataMaster.analysis?.dataProfile?.sampleRows ?? [];
  const variables = layoutMaster.analysis?.variables ?? [];

  const preview: CoercionPreview[] = [];
  for (const entry of mapping.entries) {
    const column = columns.find((c) => c.name === entry.column);
    const variable = variables.find((v) => v.key === entry.variableKey);
    const fromType = column?.datatype ?? 'unknown';
    const toType = entry.variableKey ? (variable?.datatype ?? 'unknown') : 'unmapped';
    const sample = sampleRows[0]?.[entry.column];
    preview.push({
      column: entry.column,
      variableKey: entry.variableKey,
      fromType,
      toType,
      error: coercionError(fromType, toType, sample),
      sample,
    });
  }
  return preview;
}

export function validateMapping(mapping: Mapping, dataMaster: Master, layoutMaster: Master): MappingValidation {
  const preview = buildCoercionPreview(mapping, dataMaster, layoutMaster);
  const warnings: string[] = [];

  const keyCounts = new Map<string, number>();
  for (const entry of mapping.entries) {
    if (entry.variableKey) {
      keyCounts.set(entry.variableKey, (keyCounts.get(entry.variableKey) ?? 0) + 1);
    }
  }
  for (const [key, count] of keyCounts.entries()) {
    if (count > 1) warnings.push(`Duplicate mapping for variable '${key}' (${count} columns)`);
  }

  const variables = layoutMaster.analysis?.variables ?? [];
  for (const v of variables) {
    if (v.required && !mapping.entries.some((e) => e.variableKey === v.key)) {
      warnings.push(`Required variable '${v.key}' (${v.label}) is not mapped`);
    }
  }

  for (const row of preview) {
    if (row.error && row.variableKey) {
      warnings.push(`Column '${row.column}' -> '${row.variableKey}': ${row.error}`);
    }
  }

  return { coercionPreview: preview, warnings };
}
