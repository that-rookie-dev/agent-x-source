import { randomUUID } from 'node:crypto';
import type { Pool, QueryResultRow } from 'pg';
import type {
  CreateDocumentTemplateInput,
  DocumentTemplate,
  TemplateAnalysisStatus,
  TemplateField,
  TemplateFormat,
  UpdateDocumentTemplateInput,
} from '@agentx/shared';

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseFields(raw: unknown): TemplateField[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      return parseFields(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const fields: TemplateField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    if (!key) continue;
    const field: TemplateField = {
      key,
      label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key,
      required: o.required === true,
    };
    if (typeof o.example === 'string') field.example = o.example;
    if (typeof o.context === 'string') field.context = o.context;
    if (typeof o.blankToken === 'string') field.blankToken = o.blankToken;
    if (typeof o.sampleValue === 'string') field.sampleValue = o.sampleValue;
    if (typeof o.source === 'string') {
      field.source = o.source as TemplateField['source'];
    }
    if (typeof o.page === 'number') field.page = o.page;
    if (typeof o.x === 'number') field.x = o.x;
    if (typeof o.y === 'number') field.y = o.y;
    if (typeof o.width === 'number') field.width = o.width;
    if (typeof o.fontSize === 'number') field.fontSize = o.fontSize;
    fields.push(field);
  }
  return fields;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return [];
}

function parseAnalysisStatus(raw: unknown): TemplateAnalysisStatus {
  const s = String(raw ?? 'ready');
  if (s === 'pending' || s === 'analyzing' || s === 'ready' || s === 'failed') return s;
  return 'ready';
}

export class TemplateStore {
  constructor(private pool: Pool) {}

  private rowToTemplate(row: QueryResultRow): DocumentTemplate {
    return {
      id: String(row.id),
      name: String(row.name),
      description: row.description != null ? String(row.description) : undefined,
      mimeType: String(row.mime_type ?? 'application/octet-stream'),
      size: Number(row.size ?? 0),
      storageId: String(row.storage_id),
      format: (row.format as TemplateFormat) || 'other',
      fillable: row.fillable === true || row.fillable === 't' || row.fillable === 1,
      fields: parseFields(row.fields),
      designSummary: row.design_summary != null ? String(row.design_summary) : undefined,
      tags: parseTags(row.tags),
      analysisStatus: parseAnalysisStatus(row.analysis_status),
      analysisError: row.analysis_error != null ? String(row.analysis_error) : undefined,
      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at ?? row.created_at),
    };
  }

  async insert(input: CreateDocumentTemplateInput): Promise<DocumentTemplate> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO document_templates
        (id, name, description, mime_type, size, storage_id, format, fillable, fields, design_summary, tags, analysis_status, analysis_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
       RETURNING *`,
      [
        id,
        input.name,
        input.description ?? null,
        input.mimeType,
        input.size,
        input.storageId,
        input.format,
        input.fillable,
        JSON.stringify(input.fields ?? []),
        input.designSummary ?? null,
        input.tags ?? [],
        input.analysisStatus ?? 'ready',
        input.analysisError ?? null,
      ],
    );
    if (!rows[0]) throw new Error('Failed to create template');
    return this.rowToTemplate(rows[0]);
  }

  async list(): Promise<DocumentTemplate[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM document_templates ORDER BY updated_at DESC, name ASC`,
    );
    return rows.map((r) => this.rowToTemplate(r));
  }

  async get(id: string): Promise<DocumentTemplate | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM document_templates WHERE id = $1`,
      [id],
    );
    return rows[0] ? this.rowToTemplate(rows[0]) : null;
  }

  async update(id: string, patch: UpdateDocumentTemplateInput): Promise<DocumentTemplate | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.name !== undefined) {
      sets.push(`name = $${n++}`);
      values.push(patch.name);
    }
    if ('description' in patch) {
      sets.push(`description = $${n++}`);
      values.push(patch.description ?? null);
    }
    if (patch.fields !== undefined) {
      sets.push(`fields = $${n++}::jsonb`);
      values.push(JSON.stringify(patch.fields));
    }
    if ('designSummary' in patch) {
      sets.push(`design_summary = $${n++}`);
      values.push(patch.designSummary ?? null);
    }
    if (patch.tags !== undefined) {
      sets.push(`tags = $${n++}`);
      values.push(patch.tags);
    }
    if (patch.fillable !== undefined) {
      sets.push(`fillable = $${n++}`);
      values.push(patch.fillable);
    }
    if (patch.analysisStatus !== undefined) {
      sets.push(`analysis_status = $${n++}`);
      values.push(patch.analysisStatus);
    }
    if ('analysisError' in patch) {
      sets.push(`analysis_error = $${n++}`);
      values.push(patch.analysisError ?? null);
    }
    if (patch.storageId !== undefined) {
      sets.push(`storage_id = $${n++}`);
      values.push(patch.storageId);
    }
    if (patch.size !== undefined) {
      sets.push(`size = $${n++}`);
      values.push(patch.size);
    }
    if (sets.length === 0) return this.get(id);
    sets.push('updated_at = NOW()');
    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE document_templates SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      values,
    );
    return rows[0] ? this.rowToTemplate(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM document_templates WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
