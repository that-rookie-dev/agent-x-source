import { generateId, getLogger } from '@agentx/shared';
import type {
  AttachmentPreview,
  EmbeddingProvider,
  KnowledgeChunk,
  KnowledgePage,
  KnowledgeSource,
  KnowledgeSourceStatus,
} from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';
import { extractFromPath } from '../attachments/extract.js';
import { RagDocument } from '../neural/RagDocument.js';
import type { IVectorStore } from './VectorStore.js';
import type { KnowledgeSourceStore } from './KnowledgeSourceStore.js';

const logger = getLogger();
const EMBED_BATCH_SIZE = 32;

export interface DocumentPipelineOptions {
  sourceStore: KnowledgeSourceStore;
  vectorStore: IVectorStore;
  embedder: EmbeddingProvider;
  onStatus?: (sourceId: string, status: KnowledgeSourceStatus, progress: number, detail?: string, error?: string) => void;
}

export class DocumentPipeline {
  private opts: DocumentPipelineOptions;

  constructor(opts: DocumentPipelineOptions) {
    this.opts = opts;
  }

  async process(source: KnowledgeSource): Promise<void> {
    const { sourceStore, vectorStore, embedder, onStatus } = this.opts;

    const emit = async (status: KnowledgeSourceStatus, progress: number, detail?: string, error?: string | null) => {
      const patch: Parameters<KnowledgeSourceStore['updateSource']>[1] = { status, progress };
      if (status === 'failed') {
        patch.error = error ?? 'failed';
      } else {
        patch.error = null;
      }
      await sourceStore.updateSource(source.id, patch);
      await sourceStore.addStatusEvent(source.id, status, progress, detail, error ?? undefined);
      if (onStatus) onStatus(source.id, status, progress, detail, error ?? undefined);
    };

    try {
      await emit('extracting', 5, 'Resolving attachment');
      const attachment = getAttachmentService();
      const path = await attachment.resolveAttachmentPath(source.storageId);
      if (!path) throw new Error('Attachment file not found');

      const preview = await extractFromPath(path, source.mimeType, async (detail, ratio) => {
        await emit('extracting', 5 + Math.floor(ratio * 30), detail);
      });
      if (preview.kind === 'error') throw new Error(preview.content);
      const pages = this.buildPages(preview, source);
      await emit('extracting', 35, `Extracted ${pages.length} page${pages.length === 1 ? '' : 's'}`);

      const fullText = pages.map((p) => p.content).join('\n\n');
      await emit('chunking', 40, 'Building chunks');

      const rag = new RagDocument(fullText, { title: source.name, kind: 'text' });
      const rawChunks = rag.chunks();
      const pageOffsets = this.buildPageOffsets(pages);
      const chunks: KnowledgeChunk[] = rawChunks.map((c) => {
        const pageNumber = this.findChunkPageNumber(fullText, c.content, pageOffsets);
        return {
          id: generateId('kc'),
          sourceId: source.id,
          index: c.index,
          content: c.content,
          metadata: { sourceName: source.name, kind: 'chunk', label: c.label, pageNumber, index: c.index },
        };
      });
      await emit('chunking', 50, `Built ${chunks.length} chunks from ${pages.length} pages`);

      const toEmbed = [...chunks.map((c) => c.content), ...pages.map((p) => p.content)];
      const embeddings: number[][] = new Array(toEmbed.length);
      let embedFailed = false;
      for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
        const slice = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
        const done = Math.min(i + slice.length, toEmbed.length);
        await emit(
          'embedding',
          55 + Math.floor((i / Math.max(toEmbed.length, 1)) * 25),
          `Embedding ${done}/${toEmbed.length}`,
        );
        try {
          const batch = await embedder.embedBatch(slice);
          for (let j = 0; j < batch.length; j++) {
            embeddings[i + j] = batch[j]!;
          }
        } catch (err) {
          embedFailed = true;
          logger.warn('DOCUMENT_EMBED_FAILED', 'Embedding batch failed; storing without vectors for this batch', {
            sourceId: source.id,
            offset: i,
            error: (err as Error).message,
          });
        }
      }
      if (embedFailed) {
        logger.warn('DOCUMENT_EMBED_PARTIAL', 'Some embedding batches failed; continuing with available vectors', {
          sourceId: source.id,
        });
      }
      chunks.forEach((c, i) => {
        if (embeddings[i]) c.embedding = embeddings[i];
      });
      pages.forEach((p, i) => {
        const e = embeddings[chunks.length + i];
        if (e) p.embedding = e;
      });

      const summary = this.makeSummary(chunks[0]?.content ?? pages[0]?.content ?? source.name);
      await sourceStore.updateSource(source.id, { summary });

      await emit('indexing', 85, 'Replacing previous index and writing vectors');
      await vectorStore.deleteBySource(source.id);
      await sourceStore.deleteChunksBySource(source.id);
      await sourceStore.deletePagesBySource(source.id);
      await vectorStore.insert(source.id, chunks);
      await vectorStore.insertPages(source.id, pages);
      await this.insertChunksBatched(sourceStore, source.id, chunks);
      await this.insertPagesBatched(sourceStore, source.id, pages);
      await sourceStore.updateSource(source.id, {
        chunkCount: chunks.length,
        pageCount: pages.length,
      });

      await emit('ready', 100, `Indexed ${pages.length} pages / ${chunks.length} chunks`);
    } catch (err) {
      const message = (err as Error).message;
      logger.warn('DOCUMENT_PIPELINE_FAILED', 'Document pipeline failed', { sourceId: source.id, error: message });
      await sourceStore.updateSource(source.id, { status: 'failed', progress: 0, error: message });
      await sourceStore.addStatusEvent(source.id, 'failed', 0, undefined, message);
      if (onStatus) onStatus(source.id, 'failed', 0, undefined, message);
      throw err;
    }
  }

  private async insertChunksBatched(
    sourceStore: KnowledgeSourceStore,
    sourceId: string,
    chunks: KnowledgeChunk[],
  ): Promise<void> {
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      await sourceStore.insertChunks(sourceId, chunks.slice(i, i + batchSize));
    }
  }

  private async insertPagesBatched(
    sourceStore: KnowledgeSourceStore,
    sourceId: string,
    pages: KnowledgePage[],
  ): Promise<void> {
    const batchSize = 100;
    for (let i = 0; i < pages.length; i += batchSize) {
      await sourceStore.insertPages(sourceId, pages.slice(i, i + batchSize));
    }
  }

  private buildPages(preview: AttachmentPreview, source: KnowledgeSource): KnowledgePage[] {
    if (preview.kind === 'table') {
      const header = preview.headers?.join('\t') ?? '';
      const rows = preview.rows?.map((r) => r.join('\t')) ?? [];
      const content = header ? [header, ...rows].join('\n') : rows.join('\n');
      return [
        {
          id: generateId('kp'),
          sourceId: source.id,
          pageNumber: 1,
          content,
          summary: 'Spreadsheet extract',
          sourceName: source.name,
        },
      ];
    }

    if (preview.pages && preview.pages.length > 0) {
      return preview.pages.map((content, i) => ({
        id: generateId('kp'),
        sourceId: source.id,
        pageNumber: i + 1,
        content,
        sourceName: source.name,
      }));
    }

    const text = preview.content ?? '';

    if (source.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      const parts = text.split(/---\s*Slide\s*\d+\s*---/);
      const cleaned = parts.length > 1 ? parts.slice(1) : parts;
      return cleaned
        .map((c, i) => ({
          id: generateId('kp'),
          sourceId: source.id,
          pageNumber: i + 1,
          content: c.trim(),
          sourceName: source.name,
        }))
        .filter((p) => p.content.length > 0);
    }

    return [
      {
        id: generateId('kp'),
        sourceId: source.id,
        pageNumber: 1,
        content: text,
        sourceName: source.name,
      },
    ];
  }

  private makeSummary(text: string | undefined): string {
    if (!text) return 'No summary available';
    const clean = text.replace(/\s+/g, ' ').trim();
    const first = clean.split(/[.!?]+/, 1)[0] ?? clean;
    const sentence = first.trim() || clean;
    const trimmed = sentence.length > 200 ? sentence.slice(0, 200) : sentence;
    return trimmed.endsWith('.') ? trimmed : `${trimmed}...`;
  }

  private buildPageOffsets(pages: KnowledgePage[]): Array<{ pageNumber: number; start: number }> {
    const offsets: Array<{ pageNumber: number; start: number }> = [];
    let cursor = 0;
    for (const page of pages) {
      offsets.push({ pageNumber: page.pageNumber, start: cursor });
      cursor += page.content.length + 2; // +2 for '\n\n' joiner
    }
    return offsets;
  }

  private findChunkPageNumber(fullText: string, content: string, offsets: Array<{ pageNumber: number; start: number }>): number {
    if (!content.trim()) return 1;
    const needle = content.slice(0, Math.min(120, content.length));
    let idx = fullText.indexOf(needle);
    if (idx === -1) {
      idx = fullText.indexOf(content.trim().slice(0, Math.min(120, content.trim().length)));
    }
    if (idx === -1) return 1;
    let pageNumber = 1;
    for (let i = offsets.length - 1; i >= 0; i--) {
      const offset = offsets[i];
      if (offset && idx >= offset.start) {
        pageNumber = offset.pageNumber;
        break;
      }
    }
    return pageNumber;
  }
}
