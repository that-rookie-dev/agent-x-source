import { generateId } from '@agentx/shared';
import type {
  VectorStore,
  EmbeddingProvider,
  Document,
  RAGConfig,
} from '@agentx/shared';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface IndexDocumentInput {
  id?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export class RAGEngine {
  private store: VectorStore;
  private embedder: EmbeddingProvider;
  private config: RAGConfig;
  private _indexedCount = 0;
  private _indexedAt: number | null = null;

  get indexedCount(): number {
    return this._indexedCount;
  }

  get indexedAt(): number | null {
    return this._indexedAt;
  }

  constructor(store: VectorStore, embedder: EmbeddingProvider, config: RAGConfig) {
    this.store = store;
    this.embedder = embedder;
    this.config = config;
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  get storeBackend(): VectorStore {
    return this.store;
  }

  /**
   * Index a document: chunk → embed → store in vector DB.
   */
  async indexDocument(input: IndexDocumentInput): Promise<string> {
    if (!this.config.enabled) return '';

    const docId = input.id ?? generateId('doc_');
    const chunks = this.chunkText(input.content);

    const vectors: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }> = [];

    const embeddings = await Promise.all(
      chunks.map((chunk) => this.embedder.embed(chunk)),
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const chunkId = `${docId}_chunk_${i}`;
      const vector = embeddings[i]!;

      vectors.push({
        id: chunkId,
        vector,
        metadata: {
          ...input.metadata,
          docId,
          chunkIndex: i,
          chunkCount: chunks.length,
          content: chunk,
        },
      });
    }

    if (vectors.length > 0) {
      await this.store.insert(vectors);
    }

    logger.info('RAG_INDEXED', `Indexed document ${docId} — ${chunks.length} chunks`);
    return docId;
  }

  /**
   * Index multiple documents at once.
   */
  async indexDocuments(inputs: IndexDocumentInput[]): Promise<string[]> {
    const results = await Promise.allSettled(
      inputs.map((input) => this.indexDocument(input)),
    );
    const ids: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) ids.push(result.value);
    }
    if (ids.length > 0) {
      this._indexedCount += ids.length;
      this._indexedAt = Date.now();
    }
    return ids;
  }

  /**
   * Search for relevant documents by query text.
   */
  async search(query: string, topK?: number): Promise<Document[]> {
    if (!this.config.enabled) return [];

    const vector = await this.embedder.embed(query);
    const k = topK ?? this.config.topK;
    const results = await this.store.search(vector, k);

    // Filter by minimum score
    const minScore = this.config.minScore;
    return results.filter((d) => (d.score ?? 0) >= minScore);
  }

  listIndexedPaths(): string[] {
    const storeAny = this.store as unknown as { listIndexedPaths?: () => string[] };
    if (typeof storeAny.listIndexedPaths === 'function') {
      return storeAny.listIndexedPaths();
    }
    return [];
  }

  /**
   * Delete indexed documents by ID.
   */
  async deleteDocument(docId: string): Promise<void> {
    // Find all chunks for this document and delete them
    const allDocs = await this.store.search(new Array(this.embedder.dimensions).fill(0), 10000);
    const chunkIds = allDocs
      .filter((d) => d.metadata?.['docId'] === docId)
      .map((d) => d.id);

    if (chunkIds.length > 0) {
      await this.store.delete(chunkIds);
    }
  }

  /**
   * Clear all indexed documents.
   */
  async clearAll(): Promise<void> {
    await this.store.clear();
    this._indexedCount = 0;
    this._indexedAt = null;
  }

  /**
   * Get count of indexed chunks.
   */
  async chunkCount(): Promise<number> {
    return this.store.count();
  }

  /**
   * Update RAG config at runtime.
   */
  updateConfig(config: Partial<RAGConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Split text into chunks with overlap.
   */
  private chunkText(text: string): string[] {
    const { chunkSize, chunkOverlap } = this.config;
    if (!text) return [];

    const words = text.split(/\s+/);
    if (words.length <= chunkSize) return [text];

    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length);
      chunks.push(words.slice(start, end).join(' '));
      start += chunkSize - chunkOverlap;
    }

    return chunks;
  }
}
