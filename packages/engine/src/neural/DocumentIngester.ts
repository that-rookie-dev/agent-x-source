/**
 * Document / RAG ingestion pipeline for the unified memory fabric.
 *
 * Breaks documents into atomic nodes, embeds them using the provided
 * embedder, binds them into a source nebula, and creates a top-level source
 * document node. The web-neuron UI will display the resulting cluster with
 * the source color.
 */
import type { MemoryFabric } from './MemoryFabric.js';
import { RagDocument } from './RagDocument.js';

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
}

export interface DocumentIngestResult {
  sourceId: string;
  sourceNodeId?: string;
  nodes: Array<{ id: string; label: string; content: string }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string }>;
}

export class DocumentIngester {
  constructor(private fabric: MemoryFabric) {}

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

    const chunks = doc.chunks();
    const nodes: Array<{ id: string; label: string; content: string }> = [];
    const edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string }> = [];
    let parentNodeId: string | null = null;

    const sourceNode = await this.fabric.createNode({
      label: input.metadata?.title ?? input.name,
      category: 'source_doc',
      content: `# ${input.metadata?.title ?? input.name}\n\n${input.kind.toUpperCase()} source with ${chunks.length} chunks.`,
      sourceId: source.id,
      sessionId: input.sessionId,
      agentId: input.agentId,
    });
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
      const node = await this.fabric.createNode(nodeInput);
      nodes.push({ id: node.id, label: node.label, content: node.content });

      const sourceEdge = await this.fabric.bindEdge({
        sourceNodeId: sourceNodeId,
        targetNodeId: node.id,
        relationshipType: 'CONTAINS',
        weight: 1.0,
      });
      edges.push({ id: sourceEdge.id, sourceNodeId: sourceEdge.sourceNodeId, targetNodeId: sourceEdge.targetNodeId });

      if (parentNodeId) {
        const edge = await this.fabric.bindEdge({
          sourceNodeId: parentNodeId,
          targetNodeId: node.id,
          relationshipType: 'NEXT_STEP',
          weight: 1.0,
        });
        edges.push({ id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId });
      }
      parentNodeId = node.id;
    }

    return { sourceId: source.id, sourceNodeId, nodes, edges };
  }

  private randomColor(): string {
    const colors = ['#ff4d4d', '#4da6ff', '#ffd24d', '#4dff88', '#d24dff', '#ff8c4d', '#4dffea', '#ff4da6'];
    return colors[Math.floor(Math.random() * colors.length)] ?? '#ffffff';
  }
}
