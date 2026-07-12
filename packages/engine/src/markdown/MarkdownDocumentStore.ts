import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateId,
  getMarkdownDocumentsDir,
  getLegacyMarkdownDocumentsDir,
  deriveMarkdownTitle,
  extractMarkdownFromLegacyTsx,
  normalizeMarkdownDocumentInput,
} from '@agentx/shared';
import type {
  MarkdownDocumentRecord,
  CreateMarkdownDocumentInput,
  MarkdownDocumentPayload,
} from '@agentx/shared';

export type MarkdownDocumentDbPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const DOCUMENTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  message_id TEXT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  source_role TEXT,
  compile_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvases_created ON canvases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvases_session ON canvases(session_id, created_at DESC);
`;

const TSX_FILE = 'canvas.canvas.tsx';
const MD_FILE = 'content.md';

function deriveExcerpt(content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()]/g, ' ')
    .replace(/import\s+.+?from\s+.+?;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, 280);
}

function rowToRecord(row: Record<string, unknown>): MarkdownDocumentRecord {
  const fmt = (row['content_format'] as string) === 'legacy_tsx' || (row['content_format'] as string) === 'canvas_tsx'
    ? 'legacy_tsx'
    : 'markdown';
  return {
    id: row['id'] as string,
    sessionId: (row['session_id'] as string | null) ?? null,
    messageId: (row['message_id'] as string) ?? null,
    title: row['title'] as string,
    excerpt: (row['excerpt'] as string) ?? '',
    filePath: row['file_path'] as string,
    contentFormat: fmt,
    sourceRole: (row['source_role'] as MarkdownDocumentRecord['sourceRole']) ?? null,
    createdAt: new Date(row['created_at'] as string).toISOString(),
    updatedAt: new Date(row['updated_at'] as string).toISOString(),
  };
}

function documentDirs(id: string): string[] {
  return [
    join(getMarkdownDocumentsDir(), id),
    join(getLegacyMarkdownDocumentsDir(), id),
  ];
}

function readMarkdownFromRecord(record: MarkdownDocumentRecord): string | null {
  for (const absDir of documentDirs(record.id)) {
    const mdPath = join(absDir, MD_FILE);
    if (existsSync(mdPath)) {
      return readFileSync(mdPath, 'utf8');
    }

    const tsxPath = join(absDir, TSX_FILE);
    if (!existsSync(tsxPath)) continue;

    const tsx = readFileSync(tsxPath, 'utf8');
    const extracted = extractMarkdownFromLegacyTsx(tsx);
    if (extracted) return extracted;

    return [
      `# ${record.title}`,
      '',
      '> Legacy interactive artifact — showing preserved source.',
      '',
      '```tsx',
      tsx.slice(0, 16000),
      '```',
    ].join('\n');
  }
  return null;
}

export class MarkdownDocumentStore {
  constructor(private pool: MarkdownDocumentDbPool) {}

  static async ensureSchema(pool: MarkdownDocumentDbPool): Promise<void> {
    await pool.query(DOCUMENTS_SCHEMA_SQL);
    await pool.query(`ALTER TABLE canvases ADD COLUMN IF NOT EXISTS compile_error TEXT`);

    // Existing canvases may have been created with a NOT NULL session_id + ON DELETE CASCADE.
    // Convert the link to an optional reference so deleting a session does not delete the document.
    await pool.query(`ALTER TABLE canvases ALTER COLUMN session_id DROP NOT NULL`);
    await pool.query(`
      DO $$
      DECLARE
        conname TEXT;
        has_set_null BOOLEAN;
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'canvases'::regclass
            AND contype = 'f'
            AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (session_id)%'
            AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL%'
        ) INTO has_set_null;

        IF NOT has_set_null THEN
          SELECT c.conname INTO conname
          FROM pg_constraint c
          WHERE c.conrelid = 'canvases'::regclass
            AND c.contype = 'f'
            AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (session_id)%';

          IF conname IS NOT NULL THEN
            EXECUTE format('ALTER TABLE canvases DROP CONSTRAINT %I', conname);
          END IF;

          EXECUTE 'ALTER TABLE canvases ADD CONSTRAINT canvases_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL';
        END IF;
      END $$;
    `);
  }

  async create(input: CreateMarkdownDocumentInput): Promise<MarkdownDocumentRecord> {
    const id = generateId('mdoc');
    const absDir = join(getMarkdownDocumentsDir(), id);
    mkdirSync(absDir, { recursive: true });

    const title = deriveMarkdownTitle({
      title: input.title,
      contentTsx: input.contentTsx,
      contentMarkdown: input.contentMarkdown,
    });

    const markdown = normalizeMarkdownDocumentInput({
      title,
      contentMarkdown: input.contentMarkdown,
      contentTsx: input.contentTsx,
    });
    if (!markdown) {
      throw new Error('content or contentMarkdown is required');
    }

    const relFile = join('markdown', id, MD_FILE);
    writeFileSync(join(absDir, MD_FILE), markdown, 'utf8');

    const excerpt = deriveExcerpt(markdown);
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO canvases (id, session_id, message_id, title, excerpt, file_path, content_format, source_role, compile_error, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $9)`,
      [
        id,
        input.sessionId,
        input.messageId ?? null,
        title,
        excerpt,
        relFile.replace(/\\/g, '/'),
        'markdown',
        input.sourceRole ?? null,
        now,
      ],
    );

    return {
      id,
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      title,
      excerpt,
      filePath: relFile.replace(/\\/g, '/'),
      contentFormat: 'markdown',
      sourceRole: input.sourceRole ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async list(limit = 50, offset = 0): Promise<MarkdownDocumentRecord[]> {
    const lim = Math.max(1, Math.min(200, limit));
    const off = Math.max(0, offset);
    const { rows } = await this.pool.query(
      `SELECT * FROM canvases ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [lim, off],
    );
    return rows.map(rowToRecord);
  }

  async listForSession(sessionId: string, limit = 50): Promise<MarkdownDocumentRecord[]> {
    const lim = Math.max(1, Math.min(200, limit));
    const { rows } = await this.pool.query(
      `SELECT * FROM canvases WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [sessionId, lim],
    );
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<MarkdownDocumentRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM canvases WHERE id = $1`, [id]);
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]!);
  }

  async getContent(id: string): Promise<MarkdownDocumentPayload | null> {
    const record = await this.get(id);
    if (!record) return null;
    const contentMarkdown = readMarkdownFromRecord(record);
    if (!contentMarkdown) return null;

    return {
      record: { ...record, contentFormat: 'markdown' },
      contentMarkdown,
    };
  }

  async delete(id: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    for (const absDir of documentDirs(record.id)) {
      if (existsSync(absDir)) {
        try { rmSync(absDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
    await this.pool.query(`DELETE FROM canvases WHERE id = $1`, [id]);
    return true;
  }
}

let _store: MarkdownDocumentStore | null = null;

export function setMarkdownDocumentStoreInstance(store: MarkdownDocumentStore | null): void {
  _store = store;
}

export function getMarkdownDocumentStoreInstance(): MarkdownDocumentStore | null {
  return _store;
}
