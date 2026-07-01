/**
 * Document / RAG ingestion pipeline for the unified memory fabric.
 *
 * Breaks documents into semantic TextUnits, extracts entities and facts from
 * each chunk, embeds them, binds them into a source nebula,
 * and creates a top-level source document node. The web-neuron UI will display
 * the resulting cluster with the source color.
 */
import type { MemoryFabric } from './MemoryFabric.js';
import { RagDocument } from './RagDocument.js';
import { MemoryExtractor, type GenerateFn } from './MemoryExtractor.js';
import { validateAndFilter } from './NodeValidator.js';
import { fastOfflineExtract } from './FastOfflineExtractor.js';
import { assembleGraph } from './GraphAssembler.js';

/** Stage-level progress event fired during ingestion. */
export interface IngestProgressEvent {
  /** Named pipeline stage: parsing | chunking | source_created | embedding | extracting | storing | complete */
  stage: string;
  /** 0–100 overall progress percentage. */
  progress: number;
  /** Human-readable detail message. */
  detail?: string;
  /** Chunk index (1-based) when inside the per-chunk loop. */
  chunkIndex?: number;
  /** Total chunk count. */
  chunkCount?: number;
  /** LLM batch index (1-based) within the current chunk's extraction. */
  batchIndex?: number;
  /** Total LLM batch count for the current chunk's extraction. */
  batchCount?: number;
  /** Input tokens consumed by the LLM call for this event (if any). */
  inputTokens?: number;
  /** Output tokens produced by the LLM call for this event (if any). */
  outputTokens?: number;
}

export type IngestProgressFn = (event: IngestProgressEvent) => void;

export interface DocumentIngestInput {
  name: string;
  kind: 'pdf' | 'web' | 'markdown' | 'text' | 'json';
  content: string;
  colorHex?: string;
  sourceId?: string;
  sessionId?: string;
  agentId?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  /** Optional embedding generator. If provided, each chunk node stores an embedding. */
  embed?: (text: string) => Promise<number[]>;
  metadata?: { title?: string; author?: string; pageCount?: number };
  /** Optional LLM generator for entity/fact extraction from chunks. */
  generate?: GenerateFn;
  /** Maximum entities/facts to extract per chunk. */
  maxEntitiesPerChunk?: number;
  /** Maximum number of chunks to process (useful for very long documents). */
  maxChunks?: number;
  /** Optional progress callback fired at each pipeline stage. */
  onProgress?: IngestProgressFn;
  /** Optional cancellation check — if it returns true, ingestion aborts gracefully. */
  shouldCancel?: () => boolean;
}

export interface DocumentIngestResult {
  sourceId: string;
  sourceNodeId?: string;
  nodes: Array<{ id: string; label: string; content: string; category?: string }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; relationshipType?: string; weight?: number }>;
  /** True if ingestion was cancelled by the user. */
  cancelled?: boolean;
}

export class DocumentIngester {
  private extractor: MemoryExtractor | null;

  constructor(private fabric: MemoryFabric, generate?: GenerateFn) {
    this.extractor = generate ? new MemoryExtractor(generate, true) : null;
  }

  async ingest(input: DocumentIngestInput): Promise<DocumentIngestResult> {
    const onProgress = input.onProgress;
    const sourceColor = input.colorHex ?? this.randomColor();
    onProgress?.({ stage: 'parsing', progress: 2, detail: `Reading ${input.kind} source: ${input.name}` });
    const source = await this.fabric.createSource(input.name, input.kind, sourceColor);

    onProgress?.({ stage: 'chunking', progress: 8, detail: 'Segmenting document into semantic chunks' });
    const doc = new RagDocument(input.content, {
      title: input.metadata?.title ?? input.name,
      author: input.metadata?.author,
      pageCount: input.metadata?.pageCount,
      kind: input.kind,
    }, {
      chunkSize: input.chunkSize ?? 800,
      chunkOverlap: input.chunkOverlap ?? 100,
      splitByHeading: true,
      preserveParagraphs: true,
    });

    const allChunks = doc.chunks();
    const chunks = input.maxChunks ? allChunks.slice(0, input.maxChunks) : allChunks;
    const nodes: DocumentIngestResult['nodes'] = [];
    const edges: DocumentIngestResult['edges'] = [];
    let parentNodeId: string | null = null;

    // Emit an explicit "chunked" event so the UI log shows the total chunk count
    // as a distinct step, separate from the source creation.
    onProgress?.({ stage: 'chunked', progress: 10, detail: `Document split into ${chunks.length} chunk(s)${allChunks.length !== chunks.length ? ` (of ${allChunks.length} total, capped at maxChunks)` : ''}`, chunkCount: chunks.length });

    onProgress?.({ stage: 'source_created', progress: 12, detail: `Source nebula created — ${chunks.length} chunks to process`, chunkCount: chunks.length });
    const sourceNode = await this.fabric.createNode({
      label: input.metadata?.title ?? input.name,
      category: 'source_doc',
      content: `# ${input.metadata?.title ?? input.name}\n\n${input.kind.toUpperCase()} source with ${chunks.length} of ${allChunks.length} chunks processed.`,
      sourceId: source.id,
      sessionId: input.sessionId,
      agentId: input.agentId,
    });
    nodes.push({ id: sourceNode.id, label: sourceNode.label, content: sourceNode.content, category: sourceNode.category });
    const sourceNodeId = sourceNode.id;

    let cancelled = false;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      // Check for cancellation before starting each chunk.
      if (input.shouldCancel?.()) {
        cancelled = true;
        onProgress?.({ stage: 'cancelled', progress: 0, detail: 'Ingestion cancelled by user', chunkIndex: i, chunkCount: chunks.length });
        break;
      }
      const chunkNum = i + 1;
      const basePct = 15;
      const spanPct = 80; // 15% → 95% across all chunks
      const chunkSpan = chunks.length > 0 ? spanPct / chunks.length : spanPct;
      const chunkStart = chunks.length > 0 ? basePct + (i / chunks.length) * spanPct : basePct;
      const pct = (frac: number) => Math.max(0, Math.min(100, Math.round(chunkStart + frac * chunkSpan)));

      // ── Embedding sub-step (5% of this chunk's span) ──
      onProgress?.({ stage: 'embedding', progress: pct(0.05), detail: `Embedding chunk ${chunkNum}/${chunks.length} into vector space`, chunkIndex: chunkNum, chunkCount: chunks.length });
      let embedding: number[] | undefined;
      try {
        embedding = input.embed ? await input.embed(chunk.content) : undefined;
      } catch {
        embedding = undefined;
      }
      const nodeInput: Parameters<typeof this.fabric.createNode>[0] = {
        label: chunk.label,
        category: 'source_doc',
        content: chunk.content,
        sourceId: source.id,
        sessionId: input.sessionId,
        agentId: input.agentId,
      };
      if (embedding) {
        (nodeInput as any).embedding = embedding;
      }
      const chunkNode = await this.fabric.createNode(nodeInput);
      nodes.push({ id: chunkNode.id, label: chunkNode.label, content: chunkNode.content, category: chunkNode.category });

      const sourceEdge = await this.fabric.bindEdge({
        sourceNodeId: sourceNodeId,
        targetNodeId: chunkNode.id,
        relationshipType: 'CONTAINS',
        weight: 1.0,
      });
      edges.push({ id: sourceEdge.id, sourceNodeId: sourceEdge.sourceNodeId, targetNodeId: sourceEdge.targetNodeId, relationshipType: sourceEdge.relationshipType, weight: sourceEdge.weight });

      if (parentNodeId) {
        const edge = await this.fabric.bindEdge({
          sourceNodeId: parentNodeId,
          targetNodeId: chunkNode.id,
          relationshipType: 'NEXT_STEP',
          weight: 1.0,
        });
        edges.push({ id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, relationshipType: edge.relationshipType, weight: edge.weight });
      }
      parentNodeId = chunkNode.id;

      // ── Extraction sub-step (15% → 85% of this chunk's span) ──
      // Thread the extractor's sub-stage callback into the ingester's onProgress
      // so the UI sees atomic events (batch plan, LLM call, retry, parse,
      // normalize, fallback) instead of one opaque "extracting" event.
      if (this.extractor) {
        onProgress?.({ stage: 'extracting', progress: pct(0.15), detail: `Extracting entities from chunk ${chunkNum}/${chunks.length}`, chunkIndex: chunkNum, chunkCount: chunks.length });
        try {
          // LLM is the primary extraction method. Fast offline path is only
          // used as a last-resort fallback when no LLM is configured.
          let extracted;
          if (this.extractor.hasGenerate()) {
            extracted = await this.extractor.extract(chunk.content, {
              category: 'semantic',
              sourceId: source.id,
              sessionId: input.sessionId,
              agentId: input.agentId,
              maxNodesPerChunk: input.maxEntitiesPerChunk ?? 20,
              maxTokens: 4096,
              onProgress: (ev) => {
                // Map the extractor's batch progress onto the 0.15→0.85 slice
                // of this chunk's span so the overall bar advances continuously.
                const batchFrac = ev.batchCount && ev.batchIndex
                  ? 0.15 + 0.70 * ((ev.batchIndex - 1) / ev.batchCount)
                  : 0.15;
                onProgress?.({
                  stage: 'extracting',
                  progress: pct(batchFrac),
                  detail: `Chunk ${chunkNum}/${chunks.length} · ${ev.detail}`,
                  chunkIndex: chunkNum,
                  chunkCount: chunks.length,
                  batchIndex: ev.batchIndex,
                  batchCount: ev.batchCount,
                  inputTokens: ev.inputTokens,
                  outputTokens: ev.outputTokens,
                });
              },
            });
          } else {
            const fastResult = fastOfflineExtract(chunk.content, {
              sessionId: input.sessionId,
              agentId: input.agentId,
              sourceId: source.id,
            });
            extracted = { nodes: fastResult.nodes, edges: fastResult.edges };
          }

          // ── Storing sub-step (85% → 95% of this chunk's span) ──
          // Topology assembly.
          const assembled = assembleGraph(extracted.nodes, extracted.edges, {
            clusterId: input.sessionId,
            sourceId: source.id,
          });

          // Validation gate — drop divider/fragment nodes before persistence.
          const { nodes: validNodes, edges: validEdges } = validateAndFilter(assembled.nodes, assembled.edges);
          onProgress?.({ stage: 'storing', progress: pct(0.87), detail: `Storing ${validNodes.length} entities + ${validEdges.length} edges from chunk ${chunkNum}/${chunks.length}`, chunkIndex: chunkNum, chunkCount: chunks.length });
          const idMap = new Map<string, string>();
          for (const n of validNodes) {
            const originalId = n.id;
            // If an identical entity already exists in the brain, reuse it; otherwise create.
            const entityNode = await this.fabric.createNode({
              ...n,
              sourceId: source.id,
              sessionId: input.sessionId,
              agentId: input.agentId,
            });
            nodes.push({ id: entityNode.id, label: entityNode.label, content: entityNode.content, category: entityNode.category });
            if (originalId) {
              idMap.set(originalId, entityNode.id);
            }
            // Link the extracted entity to the chunk it came from.
            const entityEdge = await this.fabric.bindEdge({
              sourceNodeId: chunkNode.id,
              targetNodeId: entityNode.id,
              relationshipType: 'DESCRIBES',
              weight: 0.9,
            });
            edges.push({ id: entityEdge.id, sourceNodeId: entityEdge.sourceNodeId, targetNodeId: entityEdge.targetNodeId, relationshipType: entityEdge.relationshipType, weight: entityEdge.weight });
          }
          for (const e of validEdges) {
            const sourceNodeId = idMap.get(e.sourceNodeId) ?? e.sourceNodeId;
            const targetNodeId = idMap.get(e.targetNodeId) ?? e.targetNodeId;
            if (sourceNodeId === targetNodeId) continue;
            const edge = await this.fabric.bindEdge({ ...e, sourceNodeId, targetNodeId });
            edges.push({ id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, relationshipType: edge.relationshipType, weight: edge.weight });
          }
          onProgress?.({ stage: 'storing', progress: pct(0.95), detail: `Chunk ${chunkNum}/${chunks.length} stored — ${nodes.length} total nodes`, chunkIndex: chunkNum, chunkCount: chunks.length });
        } catch {
          // Best-effort extraction; ignore failures so the chunk itself is still stored.
        }
      }
    }

    if (cancelled) {
      return { sourceId: source.id, sourceNodeId, nodes, edges, cancelled: true };
    }
    onProgress?.({ stage: 'complete', progress: 100, detail: `Ingestion complete — ${nodes.length} nodes, ${edges.length} edges`, chunkCount: chunks.length });
    return { sourceId: source.id, sourceNodeId, nodes, edges };
  }

  private randomColor(): string {
    const colors = ['#ff4d4d', '#4da6ff', '#ffd24d', '#4dff88', '#d24dff', '#ff8c4d', '#4dffea', '#ff4da6'];
    return colors[Math.floor(Math.random() * colors.length)] ?? '#ffffff';
  }

  /**
   * Re-run entity extraction on an existing source's chunk nodes.
   * Used when documents were ingested without an LLM generator (e.g. before login)
   * and the generator becomes available later. Only processes sources that have
   * chunk nodes but no semantic entity nodes yet.
   */
  async reExtractSource(
    sourceId: string,
    options: {
      generate: GenerateFn;
      embed?: (text: string) => Promise<number[]>;
      sessionId?: string;
      agentId?: string;
      maxEntitiesPerChunk?: number;
      shouldCancel?: () => boolean;
      onProgress?: IngestProgressFn;
    },
  ): Promise<{ sourceId: string; extractedNodes: number; extractedEdges: number; skipped: boolean }> {
    // Load chunk nodes for this source.
    const { nodes: chunks } = await this.fabric.getNodesBySource(sourceId, { category: 'source_doc', limit: 10000 });
    if (chunks.length === 0) {
      return { sourceId, extractedNodes: 0, extractedEdges: 0, skipped: true };
    }

    // Check if semantic entities already exist for this source.
    const { nodes: existingSemantic } = await this.fabric.getNodesBySource(sourceId, { category: 'semantic', limit: 1 });
    if (existingSemantic.length > 0) {
      return { sourceId, extractedNodes: 0, extractedEdges: 0, skipped: true };
    }

    const extractor = new MemoryExtractor(options.generate, true);
    if (!extractor.hasGenerate()) {
      return { sourceId, extractedNodes: 0, extractedEdges: 0, skipped: true };
    }

    let nodeCount = 0;
    let edgeCount = 0;
    let cancelled = false;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      if (options.shouldCancel?.()) { cancelled = true; break; }

      const chunkNum = i + 1;
      const pct = (frac: number) => Math.max(0, Math.min(100, Math.round(frac * 100)));

      options.onProgress?.({
        stage: 'extracting',
        progress: pct(i / chunks.length),
        detail: `Re-extracting chunk ${chunkNum}/${chunks.length} for source ${sourceId.slice(0, 8)}`,
        chunkIndex: chunkNum,
        chunkCount: chunks.length,
      });

      try {
        const extracted = await extractor.extract(chunk.content, {
          category: 'semantic',
          sourceId,
          sessionId: options.sessionId,
          agentId: options.agentId,
          maxNodesPerChunk: options.maxEntitiesPerChunk ?? 20,
          maxTokens: 4096,
          onProgress: (ev) => {
            const batchFrac = ev.batchCount && ev.batchIndex
              ? (i / chunks.length) + (1 / chunks.length) * ((ev.batchIndex - 1) / ev.batchCount)
              : i / chunks.length;
            options.onProgress?.({
              stage: 'extracting',
              progress: pct(batchFrac),
              detail: `Chunk ${chunkNum}/${chunks.length} · ${ev.detail}`,
              chunkIndex: chunkNum,
              chunkCount: chunks.length,
              batchIndex: ev.batchIndex,
              batchCount: ev.batchCount,
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
            });
          },
        });

        // Topology assembly + validation (same as primary ingestion path).
        const assembled = assembleGraph(extracted.nodes, extracted.edges, {
          clusterId: options.sessionId,
          sourceId,
        });
        const { nodes: validNodes, edges: validEdges } = validateAndFilter(assembled.nodes, assembled.edges);

        const idMap = new Map<string, string>();
        for (const n of validNodes) {
          const originalId = n.id;
          const entityNode = await this.fabric.createNode({
            ...n,
            sourceId,
            sessionId: options.sessionId,
            agentId: options.agentId,
          });
          nodeCount++;
          if (originalId) idMap.set(originalId, entityNode.id);
          // Link entity to its source chunk.
          await this.fabric.bindEdge({
            sourceNodeId: chunk.id,
            targetNodeId: entityNode.id,
            relationshipType: 'DESCRIBES',
            weight: 0.9,
          });
          edgeCount++;
        }
        for (const e of validEdges) {
          const sourceNodeId = idMap.get(e.sourceNodeId) ?? e.sourceNodeId;
          const targetNodeId = idMap.get(e.targetNodeId) ?? e.targetNodeId;
          if (sourceNodeId === targetNodeId) continue;
          await this.fabric.bindEdge({ ...e, sourceNodeId, targetNodeId });
          edgeCount++;
        }
      } catch (e) {
        options.onProgress?.({
          stage: 'error',
          progress: pct(i / chunks.length),
          detail: `Extraction failed on chunk ${chunkNum}: ${e instanceof Error ? e.message : String(e)}`,
          chunkIndex: chunkNum,
          chunkCount: chunks.length,
        });
      }
    }

    if (cancelled) {
      options.onProgress?.({ stage: 'cancelled', progress: 0, detail: 'Re-extraction cancelled', chunkCount: chunks.length });
    } else {
      options.onProgress?.({ stage: 'complete', progress: 100, detail: `Re-extraction complete — ${nodeCount} entities, ${edgeCount} edges`, chunkCount: chunks.length });
    }

    return { sourceId, extractedNodes: nodeCount, extractedEdges: edgeCount, skipped: false };
  }
}
