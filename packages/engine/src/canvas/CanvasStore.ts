import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateId, getCanvasesDir, deriveCanvasTitle } from '@agentx/shared';
import type { AgentXCanvasRecord, CreateCanvasInput, CanvasContentFormat, CanvasContentPayload } from '@agentx/shared';
import { compileCanvasTsx, wrapMarkdownInCanvasTsx } from './CanvasCompiler.js';

export type CanvasDbPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const CANVASES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'canvas_tsx',
  source_role TEXT,
  compile_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canvases_created ON canvases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvases_session ON canvases(session_id, created_at DESC);
`;

const TSX_FILE = 'canvas.canvas.tsx';
const COMPILED_FILE = 'canvas.compiled.js';
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

function rowToRecord(row: Record<string, unknown>): AgentXCanvasRecord {
  const fmt = (row['content_format'] as string) === 'markdown' ? 'markdown' : 'canvas_tsx';
  return {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    messageId: (row['message_id'] as string) ?? null,
    title: row['title'] as string,
    excerpt: (row['excerpt'] as string) ?? '',
    filePath: row['file_path'] as string,
    contentFormat: fmt,
    sourceRole: (row['source_role'] as AgentXCanvasRecord['sourceRole']) ?? null,
    compileError: (row['compile_error'] as string) ?? null,
    createdAt: new Date(row['created_at'] as string).toISOString(),
    updatedAt: new Date(row['updated_at'] as string).toISOString(),
  };
}

async function ensureCompileErrorColumn(pool: CanvasDbPool): Promise<void> {
  await pool.query(`ALTER TABLE canvases ADD COLUMN IF NOT EXISTS compile_error TEXT`);
}

export class CanvasStore {
  constructor(private pool: CanvasDbPool) {}

  static async ensureSchema(pool: CanvasDbPool): Promise<void> {
    await pool.query(CANVASES_SCHEMA_SQL);
    await ensureCompileErrorColumn(pool);
  }

  async create(input: CreateCanvasInput): Promise<AgentXCanvasRecord> {
    const id = generateId('canvas');
    const absDir = join(getCanvasesDir(), id);
    mkdirSync(absDir, { recursive: true });

    let format: CanvasContentFormat = input.contentFormat ?? 'canvas_tsx';
    let sourceForMeta = '';
    let relFile = '';
    let compileError: string | null = null;

    const title = deriveCanvasTitle({
      title: input.title,
      contentTsx: input.contentTsx,
      contentMarkdown: input.contentMarkdown,
    });

    if (input.contentTsx?.trim()) {
      format = 'canvas_tsx';
      sourceForMeta = input.contentTsx.trim();
      relFile = join('canvases', id, TSX_FILE);
      writeFileSync(join(absDir, TSX_FILE), sourceForMeta, 'utf8');
      const compiled = await compileCanvasTsx(sourceForMeta);
      if (compiled.ok && compiled.code) {
        writeFileSync(join(absDir, COMPILED_FILE), compiled.code, 'utf8');
      } else {
        compileError = compiled.errors.join('; ');
      }
    } else if (input.contentMarkdown?.trim()) {
      if (format === 'canvas_tsx') {
        const wrapped = wrapMarkdownInCanvasTsx(title, input.contentMarkdown.trim());
        sourceForMeta = wrapped;
        relFile = join('canvases', id, TSX_FILE);
        writeFileSync(join(absDir, TSX_FILE), wrapped, 'utf8');
        const compiled = await compileCanvasTsx(wrapped);
        if (compiled.ok && compiled.code) {
          writeFileSync(join(absDir, COMPILED_FILE), compiled.code, 'utf8');
        } else {
          compileError = compiled.errors.join('; ');
        }
      } else {
        format = 'markdown';
        sourceForMeta = input.contentMarkdown.trim();
        relFile = join('canvases', id, MD_FILE);
        writeFileSync(join(absDir, MD_FILE), sourceForMeta, 'utf8');
      }
    } else {
      throw new Error('contentTsx or contentMarkdown is required');
    }

    const excerpt = deriveExcerpt(sourceForMeta);
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO canvases (id, session_id, message_id, title, excerpt, file_path, content_format, source_role, compile_error, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        id,
        input.sessionId,
        input.messageId ?? null,
        title,
        excerpt,
        relFile.replace(/\\/g, '/'),
        format,
        input.sourceRole ?? null,
        compileError,
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
      contentFormat: format,
      sourceRole: input.sourceRole ?? null,
      compileError,
      createdAt: now,
      updatedAt: now,
    };
  }

  async list(limit = 50, offset = 0): Promise<AgentXCanvasRecord[]> {
    const lim = Math.max(1, Math.min(200, limit));
    const off = Math.max(0, offset);
    const { rows } = await this.pool.query(
      `SELECT * FROM canvases ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [lim, off],
    );
    return rows.map(rowToRecord);
  }

  async listForSession(sessionId: string, limit = 50): Promise<AgentXCanvasRecord[]> {
    const lim = Math.max(1, Math.min(200, limit));
    const { rows } = await this.pool.query(
      `SELECT * FROM canvases WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [sessionId, lim],
    );
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<AgentXCanvasRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM canvases WHERE id = $1`, [id]);
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]!);
  }

  async getContent(id: string): Promise<CanvasContentPayload | null> {
    const record = await this.get(id);
    if (!record) return null;
    const absDir = join(getCanvasesDir(), id);

    if (record.contentFormat === 'markdown') {
      const mdPath = join(absDir, MD_FILE);
      if (!existsSync(mdPath)) return null;
      return { record, contentMarkdown: readFileSync(mdPath, 'utf8') };
    }

    const tsxPath = join(absDir, TSX_FILE);
    if (!existsSync(tsxPath)) return null;
    const contentTsx = readFileSync(tsxPath, 'utf8');
    const compiledPath = join(absDir, COMPILED_FILE);
    let compiledJs = existsSync(compiledPath) ? readFileSync(compiledPath, 'utf8') : undefined;
    let compileError = record.compileError;

    if (!compiledJs) {
      const compiled = await compileCanvasTsx(contentTsx);
      if (compiled.ok && compiled.code) {
        writeFileSync(compiledPath, compiled.code, 'utf8');
        compiledJs = compiled.code;
        compileError = null;
        await this.pool.query(
          `UPDATE canvases SET compile_error = NULL, updated_at = $2 WHERE id = $1`,
          [id, new Date().toISOString()],
        );
      } else if (compiled.errors.length > 0) {
        compileError = compiled.errors.join('; ');
      }
    }

    return {
      record: { ...record, compileError: compileError ?? null },
      contentTsx,
      compiledJs,
      compileError: compileError ?? null,
    };
  }

  async getCompiledJs(id: string): Promise<string | null> {
    const path = join(getCanvasesDir(), id, COMPILED_FILE);
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  }

  async delete(id: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    const absDir = join(getCanvasesDir(), id);
    if (existsSync(absDir)) {
      try { rmSync(absDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    await this.pool.query(`DELETE FROM canvases WHERE id = $1`, [id]);
    return true;
  }
}

let _store: CanvasStore | null = null;

export function setCanvasStoreInstance(store: CanvasStore | null): void {
  _store = store;
}

export function getCanvasStoreInstance(): CanvasStore | null {
  return _store;
}
