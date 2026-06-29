/**
 * High-level memory service for the unified neural brain.
 *
 * Combines the PostgreSQL-backed MemoryFabric with an embedding provider and
 * an LLM-based extractor so callers can ingest, search, and traverse memory
 * with a single API.
 */
import type { Pool } from 'pg';
import type { EmbeddingProvider } from '@agentx/shared';
import { MemoryFabric } from './MemoryFabric.js';
import { MemoryExtractor, type GenerateFn } from './MemoryExtractor.js';
import { sanitizeIngestText } from './sanitizeIngestText.js';
import { validateAndFilter } from './NodeValidator.js';
import { fastOfflineExtract } from './FastOfflineExtractor.js';
import { assembleGraph } from './GraphAssembler.js';
import type { MemoryNodeInput, MemoryEdgeInput, MemoryNode, MemoryEdge, ContextAssemblyResult, GraphWalkResult } from './MemoryFabric.js';

export interface IngestInput {
  text: string;
  category?: MemoryNodeInput['category'];
  label?: string;
  sessionId?: string;
  agentId?: string;
  sourceId?: string;
  /** When true, extract multiple atomic nodes and edges via LLM. */
  extract?: boolean;
  /** When true, embed the text locally via the configured embedding provider. */
  embed?: boolean;
}

export interface IngestResult {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

export class MemoryService {
  fabric: MemoryFabric;
  extractor: MemoryExtractor;
  private embeddingProvider: EmbeddingProvider | null;
  /** Callback fired when a neuron is activated (dedup hit or explicit fire). */
  onNeuronFired?: (nodeId: string) => void;

  constructor(
    pool: Pool,
    embeddingProvider: EmbeddingProvider | null = null,
    generate: GenerateFn | null = null,
  ) {
    this.fabric = new MemoryFabric(pool);
    this.embeddingProvider = embeddingProvider;
    const hasGenerate = generate !== null;
    this.extractor = new MemoryExtractor(generate ?? (async () => ''), hasGenerate);
  }

  async migrate(): Promise<void> {
    await this.fabric.migrate();
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const text = sanitizeIngestText(input.text);
    const nodes: MemoryNode[] = [];
    const edges: MemoryEdge[] = [];

    if (input.extract) {
      // LLM is the primary extraction method. The fast offline path is not used
      // for primary ingestion — it produces false positives on short text ("How")
      // and misses concepts in unstructured conversation ("diet plan" is not
      // capitalized). The LLM is already configured (cloud or local) and the
      // extraction path is robust (lenient edge parsing, label-based matching).
      // Fast offline extraction is only used as a last-resort fallback when the
      // generate function is null (no LLM configured at all).
      const generateIsNull = !this.extractor.hasGenerate();
      let extracted;
      if (generateIsNull) {
        // No LLM configured — use fast offline as last resort.
        const fastResult = fastOfflineExtract(text, {
          sessionId: input.sessionId,
          agentId: input.agentId,
          sourceId: input.sourceId,
        });
        extracted = { nodes: fastResult.nodes, edges: fastResult.edges };
      } else {
        extracted = await this.extractor.extract(text, {
          sessionId: input.sessionId,
          agentId: input.agentId,
          sourceId: input.sourceId,
          category: input.category,
          maxNodesPerChunk: 50,
          maxTokens: 2048,
        });
      }

      // Topology assembly (anti-hub relay, depth metrics).
      const assembled = assembleGraph(extracted.nodes, extracted.edges, {
        clusterId: input.sessionId,
        sourceId: input.sourceId,
      });

      // Validation gate — drop divider/fragment/heading-only nodes before persistence.
      const { nodes: validNodes, edges: validEdges } = validateAndFilter(assembled.nodes, assembled.edges);

      // Map extracted node IDs to actual persisted node IDs (deduplication may reuse an existing node).
      const idMap = new Map<string, string>();
      for (const n of validNodes) {
        const originalId = n.id;
        const node = await this.createNode(n, input.embed ?? false);
        nodes.push(node);
        if (originalId) {
          idMap.set(originalId, node.id);
        }
      }

      for (const e of validEdges) {
        const sourceNodeId = idMap.get(e.sourceNodeId) ?? e.sourceNodeId;
        const targetNodeId = idMap.get(e.targetNodeId) ?? e.targetNodeId;
        const edge = await this.fabric.bindEdge({ ...e, sourceNodeId, targetNodeId });
        edges.push(edge);
      }
    } else {
      const nodeInput: MemoryNodeInput = {
        label: input.label ?? text.slice(0, 100),
        category: input.category ?? 'semantic',
        content: text,
        sessionId: input.sessionId,
        agentId: input.agentId,
        sourceId: input.sourceId,
      };
      const node = await this.createNode(nodeInput, input.embed ?? false);
      nodes.push(node);
    }

    return { nodes, edges };
  }

  async search(query: string, options: { limit?: number; category?: MemoryNodeInput['category']; agentId?: string } = {}): Promise<MemoryNode[]> {
    if (!this.embeddingProvider) {
      throw new Error('No embedding provider configured');
    }
    const embedding = await this.embeddingProvider.embed(query);
    return this.fabric.vectorSearch(embedding, options);
  }

  async context(query: string, sessionId: string, options: { agentId?: string; limit?: number } = {}): Promise<ContextAssemblyResult> {
    if (!this.embeddingProvider) {
      throw new Error('No embedding provider configured');
    }
    const embedding = await this.embeddingProvider.embed(query);
    return this.fabric.assembleContext(sessionId, embedding, {
      agentId: options.agentId,
      semanticLimit: options.limit,
    });
  }

  async createNode(input: MemoryNodeInput, embed: boolean = false): Promise<MemoryNode> {
    if (embed && this.embeddingProvider) {
      input.embedding = await this.embeddingProvider.embed(input.content);
    }
    if (input.embedding && input.embedding.length > 0) {
      const duplicate = await this.fabric.findDuplicate(input.embedding, 0.95, input.category);
      if (duplicate) {
        await this.fabric.fireNeuron(duplicate.id);
        this.onNeuronFired?.(duplicate.id);
        return duplicate;
      }
    }
    return this.fabric.createNode(input);
  }

  async bindEdge(input: MemoryEdgeInput): Promise<MemoryEdge> {
    return this.fabric.bindEdge(input);
  }

  async fireNeuron(nodeId: string): Promise<void> {
    await this.fabric.fireNeuron(nodeId);
    this.onNeuronFired?.(nodeId);
  }

  async getNode(id: string): Promise<MemoryNode | null> {
    return this.fabric.getNode(id);
  }

  async graphWalk(startNodeIds: string[], maxDepth?: number): Promise<GraphWalkResult> {
    return this.fabric.graphWalk({ startNodeIds, maxDepth });
  }

  async createSource(name: string, kind: string, colorHex: string) {
    return this.fabric.createSource(name, kind, colorHex);
  }
}
