import type { Pool, QueryResultRow } from 'pg';
import type { IVectorStore } from './VectorStore.js';
import type { KnowledgeChunk, KnowledgePage, KnowledgeSearchResult } from '@agentx/shared';

export class PgVectorStore implements IVectorStore {
  readonly name = 'pgvector';
  readonly dimensions: number;
  private pool: Pool;
  private connected = false;

  constructor(pool: Pool, dimensions = 1536) {
    this.pool = pool;
    this.dimensions = dimensions;
  }

  async connect(): Promise<void> {
    const ext = await this.pool.query("SELECT 1 FROM pg_extension WHERE extname='vector'");
    if (ext.rowCount === 0) {
      throw new Error('pgvector extension is not installed; falling back to MemoryVectorStore');
    }

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS knowledge_chunk_vectors (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        embedding vector(${this.dimensions})
      )`,
    );
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_vectors_source ON knowledge_chunk_vectors(source_id)');
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_vectors_embedding ON knowledge_chunk_vectors USING ivfflat (embedding vector_cosine_ops)`);

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS knowledge_page_vectors (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        page_number INTEGER NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        embedding vector(${this.dimensions})
      )`,
    );
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_page_vectors_source ON knowledge_page_vectors(source_id)');
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_page_vectors_embedding ON knowledge_page_vectors USING ivfflat (embedding vector_cosine_ops)`);

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async insert(sourceId: string, chunks: KnowledgeChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    if (!this.connected) await this.connect();
    for (const chunk of chunks) {
      const meta = { ...chunk.metadata, sourceId, kind: 'chunk' };
      const vector = this.toVectorLiteral(chunk.embedding ?? new Array(this.dimensions).fill(0));
      await this.pool.query(
        `INSERT INTO knowledge_chunk_vectors (id, source_id, chunk_id, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector(${this.dimensions}))
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           metadata = EXCLUDED.metadata,
           embedding = EXCLUDED.embedding`,
        [chunk.id, sourceId, chunk.id, chunk.content, JSON.stringify(meta), vector],
      );
    }
  }

  async insertPages(sourceId: string, pages: KnowledgePage[]): Promise<void> {
    if (pages.length === 0) return;
    if (!this.connected) await this.connect();
    for (const page of pages) {
      const meta = {
        sourceId,
        kind: 'page' as const,
        pageNumber: page.pageNumber,
        ...(page.sourceName ? { sourceName: page.sourceName } : {}),
      };
      const vector = this.toVectorLiteral(page.embedding ?? new Array(this.dimensions).fill(0));
      await this.pool.query(
        `INSERT INTO knowledge_page_vectors (id, source_id, page_id, page_number, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector(${this.dimensions}))
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           metadata = EXCLUDED.metadata,
           embedding = EXCLUDED.embedding`,
        [page.id, sourceId, page.id, page.pageNumber, page.content, JSON.stringify(meta), vector],
      );
    }
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_chunk_vectors WHERE source_id = $1', [sourceId]);
    await this.pool.query('DELETE FROM knowledge_page_vectors WHERE source_id = $1', [sourceId]);
  }

  async search(query: string, embed: (text: string) => Promise<number[]>, topK: number, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    const q = this.toVectorLiteral(await embed(query));
    const where = sourceId ? 'WHERE source_id = $3' : '';
    const params = sourceId ? [q, topK, sourceId] : [q, topK];
    const [chunkRows, pageRows] = await Promise.all([
      this.pool.query<QueryResultRow>(
        `SELECT id, source_id, content, metadata, embedding <=> $1::vector(${this.dimensions}) AS distance
         FROM knowledge_chunk_vectors
         ${where}
         ORDER BY embedding <=> $1::vector(${this.dimensions})
         LIMIT $2`,
        params,
      ),
      this.pool.query<QueryResultRow>(
        `SELECT id, source_id, content, metadata, embedding <=> $1::vector(${this.dimensions}) AS distance
         FROM knowledge_page_vectors
         ${where}
         ORDER BY embedding <=> $1::vector(${this.dimensions})
         LIMIT $2`,
        params,
      ),
    ]);

    const all: KnowledgeSearchResult[] = [];
    for (const row of chunkRows.rows) all.push(this.toResult(row));
    for (const row of pageRows.rows) all.push(this.toResult(row));
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, topK);
  }

  async searchPages(query: string, embed: (text: string) => Promise<number[]>, topK: number, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    const q = this.toVectorLiteral(await embed(query));
    const where = sourceId ? 'WHERE source_id = $3' : '';
    const params = sourceId ? [q, topK, sourceId] : [q, topK];
    const { rows } = await this.pool.query<QueryResultRow>(
      `SELECT id, source_id, content, metadata, embedding <=> $1::vector(${this.dimensions}) AS distance
       FROM knowledge_page_vectors
       ${where}
       ORDER BY embedding <=> $1::vector(${this.dimensions})
       LIMIT $2`,
      params,
    );
    return rows.map((r) => this.toResult(r));
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<QueryResultRow>(
      `SELECT (
        (SELECT count(*)::int FROM knowledge_chunk_vectors) +
        (SELECT count(*)::int FROM knowledge_page_vectors)
      ) AS total`,
    );
    const total = rows[0]?.total;
    return typeof total === 'number' ? total : 0;
  }

  private toResult(row: QueryResultRow): KnowledgeSearchResult {
    const distance = Number(row.distance ?? 0);
    const score = Math.max(0, 1 - distance);
    const metadata = (row.metadata as Record<string, unknown> | undefined) ?? {};
    return {
      id: row.id as string,
      content: row.content as string,
      sourceId: row.source_id as string,
      sourceName: (metadata.sourceName as string) ?? '',
      score,
      kind: (metadata.kind as 'chunk' | 'page' | 'entity' | 'summary') ?? 'chunk',
      metadata,
    };
  }

  private padToDimensions(vec: number[]): number[] {
    if (vec.length === this.dimensions) return vec;
    if (vec.length > this.dimensions) return vec.slice(0, this.dimensions);
    const out = new Array(this.dimensions).fill(0);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i];
    return out;
  }

  /**
   * node-pg serializes JS arrays as Postgres array literals `{"1","2"}`,
   * which pgvector rejects. Pass a `[1,2,3]` string instead (same as MemoryFabric).
   */
  private toVectorLiteral(vec: number[]): string {
    const padded = this.padToDimensions(vec);
    return `[${padded.join(',')}]`;
  }
}
