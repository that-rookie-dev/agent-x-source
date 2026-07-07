import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { VectorStore, Document } from '@agentx/shared';

interface VectorRecord {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  content: string;
}

export class MemoryVectorStore implements VectorStore {
  readonly name = 'memory';
  readonly dimensions: number;
  private static readonly MAX_RECORDS = 2_000;
  private records: Map<string, VectorRecord> = new Map();
  private keywordIndex: Map<string, Set<string>> = new Map();
  private persistencePath: string | null = null;

  constructor(dimensions = 1536, persistenceFile?: string) {
    this.dimensions = dimensions;
    if (persistenceFile) {
      this.persistencePath = persistenceFile;
    }
  }

  async connect(): Promise<void> {
    if (this.persistencePath && existsSync(this.persistencePath)) {
      try {
        const data = JSON.parse(readFileSync(this.persistencePath, 'utf-8')) as VectorRecord[];
        for (const r of data) {
          this.records.set(r.id, r);
          this.indexKeywords(r.id, r.content);
        }
      } catch {
        // Corrupted persistence file — start fresh
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.persist();
  }

  async insert(documents: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void> {
    for (const doc of documents) {
      const content = (doc.metadata?.['content'] as string) ?? '';
      this.records.set(doc.id, {
        id: doc.id,
        vector: doc.vector,
        metadata: doc.metadata,
        content,
      });
      this.indexKeywords(doc.id, content);
    }
    this.evictOverflow();
  }

  private evictOverflow(): void {
    if (this.records.size <= MemoryVectorStore.MAX_RECORDS) return;
    const excess = this.records.size - MemoryVectorStore.MAX_RECORDS;
    const victims = [...this.records.keys()].slice(0, excess);
    void this.delete(victims);
  }

  async search(query: number[], topK = 10, keywordQuery?: string): Promise<Document[]> {
    const scored: Array<{ record: VectorRecord; score: number }> = [];

    for (const record of this.records.values()) {
      let score = this.cosineSimilarity(query, record.vector);

      // Hybrid scoring: boost by keyword match if keywordQuery provided
      if (keywordQuery) {
        const keywordScore = this.keywordScore(record.id, keywordQuery);
        score = score * 0.7 + keywordScore * 0.3;
      }

      scored.push({ record, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    return top.map((s) => ({
      id: s.record.id,
      content: s.record.content,
      metadata: s.record.metadata,
      score: s.score,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.records.delete(id);
      // Remove from keyword index
      for (const [, docSet] of this.keywordIndex) {
        docSet.delete(id);
      }
    }
  }

  async clear(): Promise<void> {
    this.records.clear();
    this.keywordIndex.clear();
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  listIndexedPaths(): string[] {
    const paths = new Set<string>();
    for (const record of this.records.values()) {
      const path = record.metadata?.['path'] as string;
      if (path) paths.add(path);
    }
    return [...paths].sort();
  }

  private indexKeywords(docId: string, content: string): void {
    const words = content.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    for (const word of words) {
      if (!this.keywordIndex.has(word)) {
        this.keywordIndex.set(word, new Set());
      }
      this.keywordIndex.get(word)!.add(docId);
    }
  }

  private keywordScore(docId: string, query: string): number {
    const queryTerms = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    if (queryTerms.length === 0) return 0;

    let matches = 0;
    for (const term of queryTerms) {
      const docSet = this.keywordIndex.get(term);
      if (docSet?.has(docId)) matches++;
    }
    return matches / queryTerms.length;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i]! * b[i]!;
      magA += a[i]! * a[i]!;
      magB += b[i]! * b[i]!;
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
