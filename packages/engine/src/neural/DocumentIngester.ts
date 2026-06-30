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
}

export interface DocumentIngestResult {
  sourceId: string;
  sourceNodeId?: string;
  nodes: Array<{ id: string; label: string; content: string; category?: string }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; relationshipType?: string; weight?: number }>;
}

export class DocumentIngester {
  private extractor: MemoryExtractor | null;

  constructor(private fabric: MemoryFabric, generate?: GenerateFn) {
    this.extractor = generate ? new MemoryExtractor(generate, true) : null;
  }

  async ingest(input: DocumentIngestInput): Promise<DocumentIngestResult> {
    const sourceColor = input.colorHex ?? this.randomColor();
    const source = await this.fabric.createSource(input.name, input.kind, sourceColor);

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

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
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

      // Extraction: pull entities and facts out of each chunk.
      if (this.extractor) {
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
              maxTokens: 2048,
            });
          } else {
            const fastResult = fastOfflineExtract(chunk.content, {
              sessionId: input.sessionId,
              agentId: input.agentId,
              sourceId: source.id,
            });
            extracted = { nodes: fastResult.nodes, edges: fastResult.edges };
          }

          // Topology assembly.
          const assembled = assembleGraph(extracted.nodes, extracted.edges, {
            clusterId: input.sessionId,
            sourceId: source.id,
          });

          // Validation gate — drop divider/fragment nodes before persistence.
          const { nodes: validNodes, edges: validEdges } = validateAndFilter(assembled.nodes, assembled.edges);
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
        } catch {
          // Best-effort extraction; ignore failures so the chunk itself is still stored.
        }
      }
    }

    return { sourceId: source.id, sourceNodeId, nodes, edges };
  }

  private randomColor(): string {
    const colors = ['#ff4d4d', '#4da6ff', '#ffd24d', '#4dff88', '#d24dff', '#ff8c4d', '#4dffea', '#ff4da6'];
    return colors[Math.floor(Math.random() * colors.length)] ?? '#ffffff';
  }
}
