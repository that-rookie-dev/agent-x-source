import type { Pool } from 'pg';
import { getLogger, KnowledgeBaseOrigin, type CreateKnowledgeSourceInput, type KnowledgeSearchResult, type KnowledgeSource } from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';
import type { MemoryFabric } from '../neural/MemoryFabric.js';
import { getEmbedderInstance, OnnxEmbeddingProvider } from '../neural/OnnxEmbeddingProvider.js';
import { DocumentIngestPipeline } from './DocumentIngestPipeline.js';
import { searchKnowledgeBaseDocuments } from './document-search.js';
import { KnowledgeBaseSourceStore } from './KnowledgeBaseSourceStore.js';

export type KnowledgeBaseStatusListener = (
  sourceId: string,
  status: KnowledgeSource['status'],
  progress: number,
  detail?: string,
  error?: string,
) => void;

export interface KnowledgeBaseServiceOptions {
  pool: Pool;
  fabric: MemoryFabric;
  embedder?: OnnxEmbeddingProvider;
}

export class KnowledgeBaseService {
  private pool: Pool;
  private fabric: MemoryFabric;
  private embedder?: OnnxEmbeddingProvider;
  private sourceStore: KnowledgeBaseSourceStore;
  private logger = getLogger();
  private statusListeners = new Set<KnowledgeBaseStatusListener>();
  private queue: string[] = [];
  private processing = false;

  constructor(opts: KnowledgeBaseServiceOptions) {
    this.pool = opts.pool;
    this.fabric = opts.fabric;
    this.embedder = opts.embedder;
    this.sourceStore = new KnowledgeBaseSourceStore(opts.pool);
  }

  onStatusChange(listener: KnowledgeBaseStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
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
        this.logger.warn('KB_STATUS_LISTENER', 'Listener failed', { sourceId, error: (err as Error).message });
      }
    }
  }

  private getEmbedder(): OnnxEmbeddingProvider {
    if (this.embedder) return this.embedder;
    const existing = getEmbedderInstance();
    if (existing) {
      this.embedder = existing;
      return existing;
    }
    const fresh = new OnnxEmbeddingProvider();
    this.embedder = fresh;
    return fresh;
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
    } satisfies CreateKnowledgeSourceInput);
  }

  getQueuePosition(sourceId: string): number | undefined {
    const idx = this.queue.indexOf(sourceId);
    return idx >= 0 ? idx + 1 : undefined;
  }

  enqueueProcess(sourceId: string): void {
    if (!this.queue.includes(sourceId)) {
      this.queue.push(sourceId);
    }
    void this.drainQueue();
  }

  async processSource(sourceId: string): Promise<void> {
    const source = await this.sourceStore.getSource(sourceId);
    if (!source) throw new Error(`Knowledge base source not found: ${sourceId}`);

    await this.sourceStore.updateSource(sourceId, { status: 'pending', progress: 0, error: null });
    this.emitStatus(sourceId, 'pending', 0, 'queued');

    const pipeline = new DocumentIngestPipeline({
      fabric: this.fabric,
      sourceStore: this.sourceStore,
      embedder: this.getEmbedder(),
      onStatus: (id, status, progress, detail, error) => {
        this.emitStatus(id, status, progress, detail, error);
      },
    });

    await pipeline.process(source, false);
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const sourceId = this.queue.shift();
        if (!sourceId) continue;
        try {
          await this.processSource(sourceId);
        } catch {
          /* errors persisted on source row */
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async search(query: string, topK = 5, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    return searchKnowledgeBaseDocuments(this.fabric, this.getEmbedder(), this.sourceStore, query, topK, sourceId);
  }

  async listSources(sessionId?: string): Promise<KnowledgeSource[]> {
    const sources = await this.sourceStore.listSources(sessionId);
    return sources.map((source) => {
      const queuePosition = this.getQueuePosition(source.id);
      return queuePosition != null ? { ...source, queuePosition } : source;
    });
  }

  async getSource(id: string): Promise<KnowledgeSource | null> {
    return this.sourceStore.getSource(id);
  }

  async listIngestEvents(sourceId: string) {
    return this.sourceStore.listIngestEvents(sourceId);
  }

  async deleteSource(id: string): Promise<void> {
    await this.fabric.pruneSource(id);
    await this.sourceStore.deleteSource(id);
  }

  async reprocessSource(id: string): Promise<void> {
    const source = await this.sourceStore.getSource(id);
    if (!source) throw new Error(`Knowledge base source not found: ${id}`);
    await this.pool.query(
      `UPDATE memory_sources SET origin = $1, status = 'pending', progress = 0, error = NULL, updated_at = NOW() WHERE id = $2::uuid`,
      [KnowledgeBaseOrigin.documentReprocess, id],
    );
    this.emitStatus(id, 'pending', 0, 'reprocess');
    this.enqueueProcess(id);
  }
}
