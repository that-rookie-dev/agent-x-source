import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import type { EmbeddingProvider, KnowledgeChunk, KnowledgeSearchResult, KnowledgeSource } from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';
import { getEmbedderInstance, OnnxEmbeddingProvider } from '../neural/OnnxEmbeddingProvider.js';
import { createVectorStore } from './VectorStoreFactory.js';
import { KnowledgeSourceStore } from './KnowledgeSourceStore.js';
import { DocumentPipeline } from './DocumentPipeline.js';
import type { IVectorStore } from './VectorStore.js';

export interface KnowledgeBaseManagerOptions {
  pool: Pool;
  dataDir: string;
  embedder?: EmbeddingProvider;
}

export type KnowledgeStatusListener = (
  sourceId: string,
  status: KnowledgeSource['status'],
  progress: number,
  detail?: string,
  error?: string,
) => void;

/** Heuristic: TOC / index pages are keyword-dense but rarely answer content questions. */
function looksLikeIndexOrToc(content: string): boolean {
  const text = content.trim();
  if (text.length < 80) return false;
  if (/^(no extractable text)/i.test(text)) return true;
  const lower = text.toLowerCase();
  if (/\b(table of contents|contents|index of|list of hymns|abbreviations)\b/.test(lower)) {
    return true;
  }
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 6) return false;
  const dotted = lines.filter((l) => /\.{3,}\s*\d+\s*$/.test(l) || /\s+\d{1,4}\s*$/.test(l)).length;
  return dotted / lines.length >= 0.45;
}

export class KnowledgeBaseManager {
  private pool: Pool;
  private dataDir: string;
  private embedder?: EmbeddingProvider;
  private vectorStore!: IVectorStore;
  private sourceStore!: KnowledgeSourceStore;
  private logger = getLogger();
  private statusListeners = new Set<KnowledgeStatusListener>();

  constructor(opts: KnowledgeBaseManagerOptions) {
    this.pool = opts.pool;
    this.dataDir = opts.dataDir;
    this.embedder = opts.embedder;
  }

  /** Subscribe to pipeline stage updates (extracting → chunking → … → ready). */
  onStatusChange(listener: KnowledgeStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private emitStatus(
    sourceId: string,
    status: KnowledgeSource['status'],
    progress: number,
    detail?: string,
    error?: string,
  ): void {
    for (const listener of this.statusListeners) {
      try {
        listener(sourceId, status, progress, detail, error);
      } catch (err) {
        this.logger.warn('KNOWLEDGE_STATUS_LISTENER', 'Status listener failed', {
          sourceId,
          error: (err as Error).message,
        });
      }
    }
  }

  private getEmbedder(): EmbeddingProvider {
    if (this.embedder) return this.embedder;
    const existing = getEmbedderInstance();
    if (existing) return existing;
    const fresh = new OnnxEmbeddingProvider();
    this.embedder = fresh;
    return fresh;
  }

  async bootstrap(): Promise<void> {
    // Use 1536 to align with the default pgvector migration dimension.
    this.vectorStore = await createVectorStore(this.pool, this.dataDir, { dimensions: 1536 });
    this.sourceStore = new KnowledgeSourceStore(this.pool);
  }

  async uploadSource(buffer: Buffer, filename: string, mimeType: string, sessionId?: string): Promise<KnowledgeSource> {
    const attachment = await getAttachmentService().saveFromBuffer(
      sessionId ?? 'global',
      filename,
      buffer,
      mimeType,
      'upload',
    );
    return this.sourceStore.insertSource({
      name: filename,
      mimeType,
      size: buffer.length,
      storageId: attachment.id,
      sessionId,
    });
  }

  async processSource(sourceId: string): Promise<void> {
    const source = await this.sourceStore.getSource(sourceId);
    if (!source) throw new Error(`Knowledge source not found: ${sourceId}`);

    await this.sourceStore.updateSource(sourceId, { status: 'pending', progress: 0, error: null });
    this.emitStatus(sourceId, 'pending', 0, 'queued');

    const pipeline = new DocumentPipeline({
      sourceStore: this.sourceStore,
      vectorStore: this.vectorStore,
      embedder: this.getEmbedder(),
      onStatus: (_id, status, progress, detail, error) => {
        this.logger.info('KNOWLEDGE_STATUS', 'Status update', { sourceId, status, progress, detail });
        this.emitStatus(sourceId, status, progress, detail, error);
      },
    });

    await pipeline.process(source);
  }

  async search(query: string, topK = 5, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    const embed = (text: string) => this.getEmbedder().embed(text);
    const dense = await this.vectorStore.search(query, embed, Math.max(topK * 4, 20), sourceId);
    return this.pageAwareRerank(dense, topK, sourceId);
  }

  async searchPages(query: string, topK = 5, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    const results = await this.vectorStore.searchPages(
      query,
      (text) => this.getEmbedder().embed(text),
      topK,
      sourceId,
    );
    return this.enrichSourceNames(results);
  }

  /** Resolve missing sourceName from the source registry (page vectors historically omitted it). */
  private async enrichSourceNames(results: KnowledgeSearchResult[]): Promise<KnowledgeSearchResult[]> {
    if (results.length === 0) return results;
    const ids = [...new Set(results.map((r) => r.sourceId).filter(Boolean))];
    const names = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        const source = await this.sourceStore.getSource(id);
        if (source?.name) names.set(id, source.name);
      }),
    );
    return results.map((r) => ({
      ...r,
      sourceName: r.sourceName?.trim() ? r.sourceName : (names.get(r.sourceId) ?? r.sourceId),
    }));
  }

  /**
   * PageIndex hybrid RAG: expand each vector hit with its page and adjacent chunks,
   * then re-rank with reciprocal-rank style fusion so the model receives coherent,
   * page-grounded context instead of random snippets.
   */
  private async pageAwareRerank(dense: KnowledgeSearchResult[], topK: number, _sourceId?: string): Promise<KnowledgeSearchResult[]> {
    if (dense.length === 0) return [];

    const sourceIds = [...new Set(dense.map((r) => r.sourceId))];
    const sourceData = await Promise.all(
      sourceIds.map(async (sid) => ({
        sourceId: sid,
        source: await this.sourceStore.getSource(sid),
        chunks: await this.sourceStore.getChunksBySource(sid),
        pages: await this.sourceStore.getPagesBySource(sid),
      })),
    );
    const sourceNameById = new Map(sourceData.map((d) => [d.sourceId, d.source?.name ?? d.sourceId]));
    const pagesByNumber = new Map<string, Map<number, { id: string; content: string; summary?: string }>>();
    for (const d of sourceData) {
      const map = new Map<number, { id: string; content: string; summary?: string }>();
      for (const p of d.pages) map.set(p.pageNumber, p);
      pagesByNumber.set(d.sourceId, map);
    }
    const chunksByIndex = new Map<string, Map<number, KnowledgeChunk>>();
    for (const d of sourceData) {
      const map = new Map<number, KnowledgeChunk>();
      for (const c of d.chunks) map.set(c.index, c);
      chunksByIndex.set(d.sourceId, map);
    }

    const scored = new Map<string, { result: KnowledgeSearchResult; score: number }>();
    const rrfK = 60;

    const add = (r: KnowledgeSearchResult, score: number) => {
      const existing = scored.get(r.id);
      if (existing) {
        existing.score += score;
        if (r.score > existing.result.score) existing.result = r;
      } else {
        scored.set(r.id, { result: { ...r, sourceName: sourceNameById.get(r.sourceId) ?? r.sourceName }, score });
      }
    };

    for (const [rank, hit] of dense.entries()) {
      const denseScore = 1 / (rrfK + rank);
      add(hit, denseScore);

      if (hit.kind !== 'chunk') continue;
      const pageNumber = hit.metadata?.pageNumber as number | undefined;
      const chunkIndex = hit.metadata?.index as number | undefined;
      if (pageNumber == null || chunkIndex == null) continue;

      const sourcePageMap = pagesByNumber.get(hit.sourceId);
      if (sourcePageMap) {
        const page = sourcePageMap.get(pageNumber);
        if (page) {
          add({
            id: page.id,
            content: page.content,
            sourceId: hit.sourceId,
            sourceName: sourceNameById.get(hit.sourceId) ?? hit.sourceName,
            score: hit.score,
            kind: 'page',
            metadata: { pageNumber, sourceName: sourceNameById.get(hit.sourceId), sourceId: hit.sourceId },
          }, denseScore * 0.7);
        }
      }

      const sourceChunkMap = chunksByIndex.get(hit.sourceId);
      if (sourceChunkMap) {
        for (const delta of [-1, 1]) {
          const neighbor = sourceChunkMap.get(chunkIndex + delta);
          if (neighbor) {
            add({
              id: neighbor.id,
              content: neighbor.content,
              sourceId: hit.sourceId,
              sourceName: sourceNameById.get(hit.sourceId) ?? hit.sourceName,
              score: hit.score,
              kind: 'chunk',
              metadata: { ...neighbor.metadata, sourceName: sourceNameById.get(hit.sourceId), sourceId: hit.sourceId },
            }, denseScore * 0.5);
          }
        }
      }
    }

    const results = [...scored.values()]
      .map((s) => {
        // Soft-demote table-of-contents / index pages so mantra body text ranks higher.
        const penalty = looksLikeIndexOrToc(s.result.content) ? 0.55 : 1;
        return { result: s.result, score: s.score * penalty };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => ({
        ...s.result,
        sourceName: s.result.sourceName?.trim()
          ? s.result.sourceName
          : (sourceNameById.get(s.result.sourceId) ?? s.result.sourceId),
      }));
    return results;
  }

  async listSources(sessionId?: string): Promise<KnowledgeSource[]> {
    return this.sourceStore.listSources(sessionId);
  }

  async getSource(id: string): Promise<KnowledgeSource | null> {
    return this.sourceStore.getSource(id);
  }

  async deleteSource(id: string): Promise<void> {
    await this.sourceStore.deleteSource(id);
    await this.vectorStore.deleteBySource(id);
  }

  async reprocessSource(id: string): Promise<void> {
    const source = await this.sourceStore.getSource(id);
    if (!source) throw new Error(`Knowledge source not found: ${id}`);
    await this.sourceStore.updateSource(id, { status: 'pending', progress: 0, error: null });
    this.emitStatus(id, 'pending', 0, 'reprocess');
    // Run the re-ingestion in the background so the caller returns immediately.
    void this.processSource(id).catch((err) => {
      this.logger.warn('REPROCESS_FAILED', 'Reprocessing failed', { sourceId: id, error: (err as Error).message });
    });
  }
}
