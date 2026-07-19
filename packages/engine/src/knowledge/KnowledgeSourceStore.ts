import type { Pool, QueryResultRow } from 'pg';
import { generateId, getLogger } from '@agentx/shared';
import type {
  CreateKnowledgeSourceInput,
  KnowledgeChunk,
  KnowledgePage,
  KnowledgeSource,
  KnowledgeSourceStatus,
} from '@agentx/shared';

const logger = getLogger();

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJson<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value) || typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class KnowledgeSourceStore {
  constructor(private pool: Pool) {}

  private rowToSource(row: QueryResultRow): KnowledgeSource {
    return {
      id: row.id as string,
      sessionId: row.session_id ? String(row.session_id) : undefined,
      name: row.name as string,
      mimeType: row.mime_type as string,
      size: Number(row.size),
      storageId: row.storage_id as string,
      status: row.status as KnowledgeSourceStatus,
      progress: Number(row.progress),
      error: row.error ? String(row.error) : undefined,
      summary: row.summary ? String(row.summary) : undefined,
      chunkCount: row.chunk_count != null ? Number(row.chunk_count) : undefined,
      pageCount: row.page_count != null ? Number(row.page_count) : undefined,
      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at),
    };
  }

  async insertSource(input: CreateKnowledgeSourceInput): Promise<KnowledgeSource> {
    const id = generateId('ks');
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO knowledge_sources
        (id, session_id, name, mime_type, size, storage_id, status, progress, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, NOW(), NOW())`,
      [id, input.sessionId ?? null, input.name, input.mimeType, input.size, input.storageId],
    );
    return {
      id,
      sessionId: input.sessionId,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      storageId: input.storageId,
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateSource(
    id: string,
    patch: Partial<Pick<KnowledgeSource, 'status' | 'progress' | 'summary' | 'chunkCount' | 'pageCount'>> & {
      /** Pass `null` to clear a sticky FAULT / error after reprocess. */
      error?: string | null;
    },
  ): Promise<KnowledgeSource | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.status !== undefined) {
      sets.push(`status = $${n++}`);
      values.push(patch.status);
    }
    if (patch.progress !== undefined) {
      sets.push(`progress = $${n++}`);
      values.push(patch.progress);
    }
    // Use `in` so callers can clear error with `null` (undefined alone is ignored).
    if ('error' in patch) {
      sets.push(`error = $${n++}`);
      values.push(patch.error ?? null);
    }
    if (patch.summary !== undefined) {
      sets.push(`summary = $${n++}`);
      values.push(patch.summary ?? null);
    }
    if (patch.chunkCount !== undefined) {
      sets.push(`chunk_count = $${n++}`);
      values.push(patch.chunkCount ?? null);
    }
    if (patch.pageCount !== undefined) {
      sets.push(`page_count = $${n++}`);
      values.push(patch.pageCount ?? null);
    }
    if (sets.length === 0) return this.getSource(id);

    sets.push('updated_at = NOW()');
    values.push(id);
    const q = `UPDATE knowledge_sources SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`;
    const { rows } = await this.pool.query(q, values);
    if (!rows[0]) return null;
    return this.rowToSource(rows[0]);
  }

  async getSource(id: string): Promise<KnowledgeSource | null> {
    const { rows } = await this.pool.query('SELECT * FROM knowledge_sources WHERE id = $1', [id]);
    if (!rows[0]) return null;
    return this.rowToSource(rows[0]);
  }

  async listSources(sessionId?: string): Promise<KnowledgeSource[]> {
    const q =
      sessionId != null
        ? 'SELECT * FROM knowledge_sources WHERE session_id = $1 ORDER BY created_at DESC'
        : 'SELECT * FROM knowledge_sources ORDER BY created_at DESC';
    const { rows } = await this.pool.query(q, sessionId != null ? [sessionId] : []);
    return rows.map((r) => this.rowToSource(r));
  }

  async deleteSource(id: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_sources WHERE id = $1', [id]);
  }

  private rowToChunk(row: QueryResultRow): KnowledgeChunk {
    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      index: Number(row.index),
      content: row.content as string,
      embedding: parseJson<number[]>(row.embedding),
      metadata: parseJson<Record<string, unknown>>(row.metadata) ?? {},
    };
  }

  async insertChunks(sourceId: string, chunks: KnowledgeChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let n = 1;
    for (const c of chunks) {
      placeholders.push(`($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++})`);
      values.push(
        c.id,
        sourceId,
        c.index,
        c.content,
        c.embedding ? JSON.stringify(c.embedding) : null,
        c.metadata ? JSON.stringify(c.metadata) : null,
      );
    }
    const q = `INSERT INTO knowledge_chunks (id, source_id, index, content, embedding, metadata)
               VALUES ${placeholders.join(', ')}
               ON CONFLICT (source_id, index) DO UPDATE SET
                 content = EXCLUDED.content,
                 embedding = EXCLUDED.embedding,
                 metadata = EXCLUDED.metadata`;
    await this.pool.query(q, values);
  }

  async insertPages(sourceId: string, pages: KnowledgePage[]): Promise<void> {
    if (pages.length === 0) return;
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let n = 1;
    for (const p of pages) {
      placeholders.push(`($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++})`);
      values.push(
        p.id,
        sourceId,
        p.pageNumber,
        p.content,
        p.summary ?? null,
        p.embedding ? JSON.stringify(p.embedding) : null,
      );
    }
    const q = `INSERT INTO knowledge_pages (id, source_id, page_number, content, summary, embedding)
               VALUES ${placeholders.join(', ')}
               ON CONFLICT (source_id, page_number) DO UPDATE SET
                 content = EXCLUDED.content,
                 summary = EXCLUDED.summary,
                 embedding = EXCLUDED.embedding`;
    await this.pool.query(q, values);
  }

  async getChunksBySource(sourceId: string): Promise<KnowledgeChunk[]> {
    const { rows } = await this.pool.query('SELECT * FROM knowledge_chunks WHERE source_id = $1 ORDER BY index', [sourceId]);
    return rows.map((r) => this.rowToChunk(r));
  }

  private rowToPage(row: QueryResultRow): KnowledgePage {
    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      pageNumber: Number(row.page_number),
      content: row.content as string,
      summary: row.summary ? String(row.summary) : undefined,
      embedding: parseJson<number[]>(row.embedding),
    };
  }

  async getPagesBySource(sourceId: string): Promise<KnowledgePage[]> {
    const { rows } = await this.pool.query('SELECT * FROM knowledge_pages WHERE source_id = $1 ORDER BY page_number', [sourceId]);
    return rows.map((r) => this.rowToPage(r));
  }

  async addStatusEvent(
    sourceId: string,
    status: KnowledgeSourceStatus,
    progress: number,
    detail?: string,
    error?: string,
  ): Promise<void> {
    const id = generateId('kse');
    try {
      await this.pool.query(
        `INSERT INTO knowledge_source_status_events (id, source_id, status, progress, detail, error)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, sourceId, status, progress, detail ?? null, error ?? null],
      );
    } catch (err) {
      logger.warn('KNOWLEDGE_STATUS_EVENT_FAIL', 'Failed to record status event', { error: (err as Error).message, sourceId });
    }
  }

  async listStatusEvents(sourceId: string): Promise<Array<{ id: string; sourceId: string; status: KnowledgeSourceStatus; progress: number; detail?: string; error?: string; createdAt: string }>> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_source_status_events WHERE source_id = $1 ORDER BY created_at ASC',
      [sourceId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      sourceId: r.source_id as string,
      status: r.status as KnowledgeSourceStatus,
      progress: Number(r.progress),
      detail: r.detail ? String(r.detail) : undefined,
      error: r.error ? String(r.error) : undefined,
      createdAt: toISOString(r.created_at),
    }));
  }

  async deleteChunksBySource(sourceId: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_chunks WHERE source_id = $1', [sourceId]);
  }

  async deletePagesBySource(sourceId: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_pages WHERE source_id = $1', [sourceId]);
  }
}
