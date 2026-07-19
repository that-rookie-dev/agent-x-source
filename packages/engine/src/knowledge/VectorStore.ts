import type { KnowledgeChunk, KnowledgePage, KnowledgeSearchResult } from '@agentx/shared';

export interface IVectorStore {
  readonly name: string;
  readonly dimensions: number;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Insert chunks for a source. */
  insert(sourceId: string, chunks: KnowledgeChunk[]): Promise<void>;
  /** Insert pages for a source. */
  insertPages(sourceId: string, pages: KnowledgePage[]): Promise<void>;

  /** Remove all vectors for a source. */
  deleteBySource(sourceId: string): Promise<void>;

  /** Search across chunks and pages. Optionally restrict to a single source. */
  search(query: string, embed: (text: string) => Promise<number[]>, topK: number, sourceId?: string): Promise<KnowledgeSearchResult[]>;

  /** Search pages only. Optionally restrict to a single source. */
  searchPages(query: string, embed: (text: string) => Promise<number[]>, topK: number, sourceId?: string): Promise<KnowledgeSearchResult[]>;

  count(): Promise<number>;
}
