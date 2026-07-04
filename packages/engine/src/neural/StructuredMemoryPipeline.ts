/**
 * StructuredMemoryPipeline — the single orchestrator for memory ingestion.
 *
 * Unifies all extraction paths into one pipeline:
 *
 *   Normalize → Segment → TextUnits → Extract → Assemble → Validate → Persist
 *
 * All entry points (MemoryService, DocumentIngester, NeuralBrainIngestionPipeline)
 * delegate to this pipeline. See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §5.
 */
import type { MemoryFabric, MemoryNodeInput, MemoryNode, MemoryEdge } from './MemoryFabric.js';
import { sanitizeIngestText } from './sanitizeIngestText.js';
import { segmentText } from './SemanticSegmenter.js';
import { MemoryExtractor, type GenerateFn, type ExtractionOptions } from './MemoryExtractor.js';
import { assembleGraph, type AssembleOptions } from './GraphAssembler.js';
import { validateAndFilter } from './NodeValidator.js';
import { deterministicNodeId } from './DeterministicId.js';
import { fastOfflineExtract } from './FastOfflineExtractor.js';

export interface PipelineInput {
  text: string;
  sessionId?: string;
  agentId?: string;
  sourceId?: string;
  category?: MemoryNodeInput['category'];
  /** Document id (for doc ingestion). */
  documentId?: string;
  /** Turn index (for chat). */
  turnIndex?: number;
  /** Chunk size for segmentation. */
  chunkSize?: number;
  /** Chunk overlap for segmentation. */
  chunkOverlap?: number;
  /** Max nodes per LLM call. */
  maxNodesPerChunk?: number;
  /** Max tokens for LLM. */
  maxTokens?: number;
  /** Whether to embed nodes. */
  embed?: boolean;
  /** Embedding function. */
  embedFn?: (text: string) => Promise<number[]>;
  /** Topology options for GraphAssembler. */
  topology?: AssembleOptions;
}

export interface StructuredPipelineResult {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  textUnitCount: number;
  llmCallCount: number;
  topology: ReturnType<typeof assembleGraph>['topology'];
}

export class StructuredMemoryPipeline {
  private extractor: MemoryExtractor;

  constructor(
    private fabric: MemoryFabric,
    generate: GenerateFn,
  ) {
    this.extractor = new MemoryExtractor(generate, true);
  }

  /**
   * Run the full 6-stage pipeline and persist results.
   */
  async run(input: PipelineInput): Promise<StructuredPipelineResult> {
    // Stage 1: Normalize
    const text = sanitizeIngestText(input.text);
    if (!text.trim()) {
      return { nodes: [], edges: [], textUnitCount: 0, llmCallCount: 0, topology: emptyTopology() };
    }

    // Stage 2: Segment
    const units = segmentText(text, {
      sessionId: input.sessionId,
      documentId: input.documentId,
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
    });

    if (units.length === 0) {
      return { nodes: [], edges: [], textUnitCount: 0, llmCallCount: 0, topology: emptyTopology() };
    }

    // Stage 3+4: Extract — LLM is the primary extraction method.
    // Fast offline path is only used as a last-resort fallback when no LLM
    // generate function is configured.
    let extracted;
    let llmCallCount = 0;
    if (!this.extractor.hasGenerate()) {
      // No LLM configured — use fast offline as last resort.
      const fastResult = fastOfflineExtract(text, {
        sessionId: input.sessionId,
        agentId: input.agentId,
        sourceId: input.sourceId,
      });
      extracted = { nodes: fastResult.nodes, edges: fastResult.edges };
    } else {
      // LLM extraction (primary path).
      const extractionOptions: ExtractionOptions = {
        sessionId: input.sessionId,
        agentId: input.agentId,
        sourceId: input.sourceId,
        category: input.category,
        maxNodesPerChunk: input.maxNodesPerChunk,
        maxTokens: input.maxTokens,
        chunkSize: input.chunkSize,
        chunkOverlap: input.chunkOverlap,
      };
      extracted = await this.extractor.extractFromTextUnits(units, extractionOptions);
      llmCallCount = extracted.llmCallCount ?? 1;
    }

    // Stage 5: Assemble (topology constraints)
    const assembled = assembleGraph(extracted.nodes, extracted.edges, {
      ...input.topology,
      clusterId: input.sessionId,
      sourceId: input.sourceId,
    });

    // Stage 6: Validate
    const { nodes: validNodes, edges: validEdges } = validateAndFilter(assembled.nodes, assembled.edges);

    // Assign deterministic IDs so re-ingestion produces the same node IDs.
    // Extractor-provided ids (e.g. "node-1") are logical only; replace them with
    // content-addressed UUIDs valid for the memory_nodes UUID primary key, and
    // remap edge endpoints that reference the original logical ids.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const reassignedIds = new Map<string, string>();
    for (const node of validNodes) {
      if (node.id && uuidRe.test(node.id)) continue;
      const newId = deterministicNodeId(node.label, node.content, input.sourceId ?? input.sessionId);
      if (node.id) reassignedIds.set(node.id, newId);
      node.id = newId;
    }
    for (const edge of validEdges) {
      edge.sourceNodeId = reassignedIds.get(edge.sourceNodeId) ?? edge.sourceNodeId;
      edge.targetNodeId = reassignedIds.get(edge.targetNodeId) ?? edge.targetNodeId;
    }

    // Community summarization is now handled asynchronously by the
    // IngestionWorker's `community_summarize` job (via CommunitySummarizer),
    // which runs Louvain detection + LLM summarization on the full graph.
    const allNodes = validNodes;
    const allEdges = validEdges;

    // Persist
    const nodes: MemoryNode[] = [];
    const edges: MemoryEdge[] = [];
    const idMap = new Map<string, string>();

    for (const node of allNodes) {
      // Embed if requested.
      if (input.embed && input.embedFn && !node.embedding) {
        try {
          node.embedding = await input.embedFn(node.content);
        } catch { /* best-effort */ }
      }
      // Embedding dedupe (fuzzy merge safety net).
      if (node.embedding && node.embedding.length > 0) {
        const duplicate = await this.fabric.findDuplicate(node.embedding, 0.95, node.category);
        if (duplicate) {
          await this.fabric.fireNeuron(duplicate.id);
          if (node.id) idMap.set(node.id, duplicate.id);
          nodes.push(duplicate);
          continue;
        }
      }
      const created = await this.fabric.createNode(node);
      if (node.id) idMap.set(node.id, created.id);
      nodes.push(created);
    }

    for (const edge of allEdges) {
      const sourceNodeId = idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId;
      const targetNodeId = idMap.get(edge.targetNodeId) ?? edge.targetNodeId;
      if (sourceNodeId === targetNodeId) continue;
      try {
        const created = await this.fabric.bindEdge({ ...edge, sourceNodeId, targetNodeId });
        edges.push(created);
      } catch { /* best-effort */ }
    }

    // Orphan prevention: link any node with no edges to the first connected
    // node (or the first node overall if none are connected). This ensures
    // every node is reachable in graph traversal and visualization.
    if (nodes.length > 1) {
      const connectedIds = new Set<string>();
      for (const edge of edges) {
        connectedIds.add(edge.sourceNodeId);
        connectedIds.add(edge.targetNodeId);
      }
      const orphans = nodes.filter((n) => !connectedIds.has(n.id));
      if (orphans.length > 0) {
        // Pick an anchor: first connected node, or first node overall.
        const anchor = nodes.find((n) => connectedIds.has(n.id)) ?? nodes[0]!;
        for (const orphan of orphans) {
          if (orphan.id === anchor.id) continue;
          try {
            const created = await this.fabric.bindEdge({
              sourceNodeId: anchor.id,
              targetNodeId: orphan.id,
              relationshipType: 'RELATED_TO',
              weight: 0.15,
              extractionMethod: 'INFERRED',
            });
            edges.push(created);
          } catch { /* best-effort */ }
        }
      }
    }

    return {
      nodes,
      edges,
      textUnitCount: units.length,
      llmCallCount,
      topology: assembled.topology,
    };
  }
}

function emptyTopology() {
  return {
    totalNodes: 0,
    totalEdges: 0,
    maxDepth: 0,
    avgEdgesPerNode: 0,
    maxEdgesPerNode: 0,
    violatesConstraints: false,
    violations: [],
  };
}
