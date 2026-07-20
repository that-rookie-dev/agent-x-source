import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { IVectorStore } from './VectorStore.js';
import type { KnowledgeChunk, KnowledgePage, KnowledgeSearchResult } from '@agentx/shared';

interface VectorRecord {
  id: string;
  sourceId: string;
  content: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export class MemoryVectorStore implements IVectorStore {
  readonly name = 'memory';
  readonly dimensions: number;
  private static readonly MAX_RECORDS = 2_000;
  private records: Map<string, VectorRecord> = new Map();
  private persistencePath: string | null = null;

  constructor(dimensions = 1536, persistenceFile?: string) {
    this.dimensions = dimensions;
    if (persistenceFile) {
      this.persistencePath = persistenceFile;
    }
  }

  async connect(): Promise<void> {
    if (!this.persistencePath || !existsSync(this.persistencePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.persistencePath, 'utf-8')) as VectorRecord[];
      for (const r of raw) {
        if (!r.id) continue;
        this.records.set(r.id, r);
      }
    } catch {
      // Corrupted persistence — start fresh
    }
  }

  async disconnect(): Promise<void> {
    await this.persist();
  }

  async insert(sourceId: string, chunks: KnowledgeChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.records.set(chunk.id, {
        id: chunk.id,
        sourceId,
        content: chunk.content,
        vector: chunk.embedding ?? new Array(this.dimensions).fill(0),
        metadata: { ...chunk.metadata, sourceId, kind: 'chunk' },
      });
    }
    this.evictOverflow();
  }

  async insertPages(sourceId: string, pages: KnowledgePage[]): Promise<void> {
    for (const page of pages) {
      this.records.set(page.id, {
        id: page.id,
        sourceId,
        content: page.content,
        vector: page.embedding ?? new Array(this.dimensions).fill(0),
        metadata: {
          sourceId,
          kind: 'page',
          pageNumber: page.pageNumber,
          ...(page.sourceName ? { sourceName: page.sourceName } : {}),
        },
      });
    }
    this.evictOverflow();
  }

  async deleteBySource(sourceId: string): Promise<void> {
    for (const [id, rec] of this.records) {
      if (rec.sourceId === sourceId) {
        this.records.delete(id);
      }
    }
  }

  async search(query: string, embed: (text: string) => Promise<number[]>, topK: number, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    const q = await embed(query);
    return this.searchVector(q, topK, undefined, sourceId);
  }

  async searchPages(query: string, embed: (text: string) => Promise<number[]>, topK: number, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    const q = await embed(query);
    return this.searchVector(q, topK, 'page', sourceId);
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  private searchVector(query: number[], topK: number, kind?: string, sourceId?: string): KnowledgeSearchResult[] {
    const scored: Array<{ record: VectorRecord; score: number }> = [];
    for (const record of this.records.values()) {
      if (kind && record.metadata.kind !== kind) continue;
      if (sourceId && record.sourceId !== sourceId) continue;
      const score = this.cosineSimilarity(query, record.vector);
      scored.push({ record, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => this.toSearchResult(s.record, s.score));
  }

  private toSearchResult(record: VectorRecord, score: number): KnowledgeSearchResult {
    const metadata = record.metadata;
    return {
      id: record.id,
      content: record.content,
      sourceId: record.sourceId,
      sourceName: (metadata.sourceName as string) || '',
      score,
      kind: (metadata.kind as 'chunk' | 'page' | 'entity' | 'summary') ?? 'chunk',
      metadata,
    };
  }

  private evictOverflow(): void {
    if (this.records.size <= MemoryVectorStore.MAX_RECORDS) return;
    const excess = this.records.size - MemoryVectorStore.MAX_RECORDS;
    const victims = [...this.records.keys()].slice(0, excess);
    for (const id of victims) {
      this.records.delete(id);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      dot += av * bv;
      magA += av * av;
      magB += bv * bv;
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private async persist(): Promise<void> {
    if (!this.persistencePath) return;
    const dir = this.persistencePath.substring(0, this.persistencePath.lastIndexOf('/'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = [...this.records.values()];
    writeFileSync(this.persistencePath, JSON.stringify(data), 'utf-8');
  }
}
