import { getLogger, type AttachmentPreview, type EmbeddingProvider, type KnowledgeSource, type KnowledgeSourceStatus } from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';
import { extractFromPath } from '../attachments/extract.js';
import type { MemoryFabric } from '../neural/MemoryFabric.js';
import { RagDocument } from '../neural/RagDocument.js';
import type { OnnxEmbeddingProvider } from '../neural/OnnxEmbeddingProvider.js';
import type { KnowledgeBaseSourceStore } from './KnowledgeBaseSourceStore.js';

const logger = getLogger();
const EMBED_BATCH_SIZE = 32;

interface PageDraft {
  pageNumber: number;
  content: string;
}

export interface DocumentIngestPipelineOptions {
  fabric: MemoryFabric;
  sourceStore: KnowledgeBaseSourceStore;
  embedder: EmbeddingProvider;
  onStatus?: (sourceId: string, status: KnowledgeSourceStatus, progress: number, detail?: string, error?: string) => void;
}

export class DocumentIngestPipeline {
  constructor(private opts: DocumentIngestPipelineOptions) {}

  async process(source: KnowledgeSource, _originReprocess = false): Promise<void> {
    const { fabric, sourceStore, embedder, onStatus } = this.opts;
    const activeTier = (embedder as OnnxEmbeddingProvider).activeTier ?? null;

    const emit = async (status: KnowledgeSourceStatus, progress: number, detail?: string, error?: string | null) => {
      await sourceStore.updateSource(source.id, { status, progress, error: error ?? null, embeddingTier: activeTier });
      await sourceStore.addIngestEvent(source.id, status, progress, detail);
      onStatus?.(source.id, status, progress, detail, error ?? undefined);
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

      await emit('chunking', 50, `Built ${rawChunks.length} chunks from ${pages.length} pages`);

      await fabric.pruneSource(source.id);

      const hubNode = await fabric.createNode({
        label: source.name,
        category: 'source_doc',
        content: `# ${source.name}\n\nDocument hub (${rawChunks.length} chunks, ${pages.length} pages).`,
        sourceId: source.id,
        sessionId: source.sessionId,
        unitType: 'hub',
        provenance: { sourceName: source.name, pageCount: pages.length, chunkCount: rawChunks.length },
      });

      const chunkEmbeddings: number[][] = [];
      const textsToEmbed = rawChunks.map((c) => c.content);
      const embedProgress = (done: number) =>
        55 + Math.floor((done / Math.max(textsToEmbed.length, 1)) * 27);

      for (let i = 0; i < textsToEmbed.length; i += EMBED_BATCH_SIZE) {
        const slice = textsToEmbed.slice(i, i + EMBED_BATCH_SIZE);
        const doneBefore = i;
        await emit(
          'embedding',
          embedProgress(doneBefore),
          `Embedding ${Math.min(doneBefore + 1, textsToEmbed.length)}/${textsToEmbed.length}`,
        );
        try {
          const batch = await embedder.embedBatch(slice);
          chunkEmbeddings.push(...batch);
        } catch (err) {
          logger.warn('KB_EMBED_BATCH', 'Embedding batch failed', {
            sourceId: source.id,
            error: (err as Error).message,
          });
          for (let j = 0; j < slice.length; j++) chunkEmbeddings.push([]);
        }
        const done = Math.min(i + slice.length, textsToEmbed.length);
        await emit('embedding', embedProgress(done), `Embedded ${done}/${textsToEmbed.length}`);
      }

      await emit('indexing', 82, 'Building knowledge graph');

      let prevChunkId: string | null = null;
      const indexReportEvery = Math.max(1, Math.ceil(rawChunks.length / 8));
      for (let i = 0; i < rawChunks.length; i++) {
        const chunk = rawChunks[i]!;
        const pageNumber = this.findChunkPageNumber(fullText, chunk.content, pageOffsets);
        const embedding = chunkEmbeddings[i];
        const chunkNode = await fabric.createNode({
          label: chunk.label,
          category: 'source_doc',
          content: chunk.content,
          sourceId: source.id,
          sessionId: source.sessionId,
          embedding: embedding && embedding.length > 0 ? embedding : undefined,
          unitType: 'chunk',
          provenance: {
            sourceName: source.name,
            pageNumber,
            index: chunk.index,
            kind: 'chunk',
          },
        });
        await fabric.bindEdge({
          sourceNodeId: hubNode.id,
          targetNodeId: chunkNode.id,
          relationshipType: 'CONTAINS',
          weight: 1,
        });
        if (prevChunkId) {
          await fabric.bindEdge({
            sourceNodeId: prevChunkId,
            targetNodeId: chunkNode.id,
            relationshipType: 'NEXT_STEP',
            weight: 0.5,
          });
        }
        prevChunkId = chunkNode.id;

        const shouldReport =
          i === 0
          || i === rawChunks.length - 1
          || (i + 1) % indexReportEvery === 0;
        if (shouldReport) {
          await emit(
            'indexing',
            82 + Math.floor(((i + 1) / rawChunks.length) * 10),
            `Indexing ${i + 1}/${rawChunks.length}`,
          );
        }
      }

      const summary = this.makeSummary(rawChunks[0]?.content ?? pages[0]?.content ?? source.name);
      await sourceStore.updateSource(source.id, {
        summary,
        chunkCount: rawChunks.length,
        pageCount: pages.length,
        embeddingTier: activeTier,
      });

      await emit('indexing', 94, 'Finalizing index');
      await emit('ready', 100, `Indexed ${pages.length} pages / ${rawChunks.length} chunks`);
    } catch (err) {
      const message = (err as Error).message;
      logger.warn('KB_INGEST_FAILED', 'Knowledge base ingest failed', { sourceId: source.id, error: message });
      await sourceStore.updateSource(source.id, { status: 'failed', progress: 0, error: message });
      await sourceStore.addIngestEvent(source.id, 'failed', 0, message);
      onStatus?.(source.id, 'failed', 0, undefined, message);
      throw err;
    }
  }

  private buildPages(preview: AttachmentPreview, source: KnowledgeSource): PageDraft[] {
    if (preview.kind === 'table') {
      const header = preview.headers?.join('\t') ?? '';
      const rows = preview.rows?.map((r) => r.join('\t')) ?? [];
      const content = header ? [header, ...rows].join('\n') : rows.join('\n');
      return [{ pageNumber: 1, content }];
    }

    if (preview.pages && preview.pages.length > 0) {
      return preview.pages.map((content, i) => ({ pageNumber: i + 1, content }));
    }

    const text = preview.content ?? '';
    if (source.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      const parts = text.split(/---\s*Slide\s*\d+\s*---/);
      const cleaned = parts.length > 1 ? parts.slice(1) : parts;
      return cleaned
        .map((c, i) => ({ pageNumber: i + 1, content: c.trim() }))
        .filter((p) => p.content.length > 0);
    }

    return [{ pageNumber: 1, content: text }];
  }

  private makeSummary(text: string | undefined): string {
    if (!text) return 'No summary available';
    const clean = text.replace(/\s+/g, ' ').trim();
    const first = clean.split(/[.!?]+/, 1)[0] ?? clean;
    const sentence = first.trim() || clean;
    const trimmed = sentence.length > 200 ? sentence.slice(0, 200) : sentence;
    return trimmed.endsWith('.') ? trimmed : `${trimmed}...`;
  }

  private buildPageOffsets(pages: PageDraft[]): Array<{ pageNumber: number; start: number }> {
    const offsets: Array<{ pageNumber: number; start: number }> = [];
    let cursor = 0;
    for (const page of pages) {
      offsets.push({ pageNumber: page.pageNumber, start: cursor });
      cursor += page.content.length + 2;
    }
    return offsets;
  }

  private findChunkPageNumber(
    fullText: string,
    content: string,
    offsets: Array<{ pageNumber: number; start: number }>,
  ): number {
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
