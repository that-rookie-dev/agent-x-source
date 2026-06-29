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

  constructor(
    pool: Pool,
    embeddingProvider: EmbeddingProvider | null = null,
    generate: GenerateFn | null = null,
  ) {
    this.fabric = new MemoryFabric(pool);
    this.embeddingProvider = embeddingProvider;
    this.extractor = new MemoryExtractor(generate ?? (async () => ''));
  }

  async migrate(): Promise<void> {
    await this.fabric.migrate();
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const nodes: MemoryNode[] = [];
    const edges: MemoryEdge[] = [];

    if (input.extract) {
      const extracted = await this.extractor.extract(input.text, {
        sessionId: input.sessionId,
        agentId: input.agentId,
        sourceId: input.sourceId,
        category: input.category,
        maxNodesPerChunk: 50,
        maxTokens: 2048,
      });

      // Map extracted node IDs to actual persisted node IDs (deduplication may reuse an existing node).
      const idMap = new Map<string, string>();
      for (const n of extracted.nodes) {
        const originalId = n.id;
        const node = await this.createNode(n, input.embed ?? false);
        nodes.push(node);
        if (originalId) {
          idMap.set(originalId, node.id);
        }
      }

      for (const e of extracted.edges) {
        const sourceNodeId = idMap.get(e.sourceNodeId) ?? e.sourceNodeId;
        const targetNodeId = idMap.get(e.targetNodeId) ?? e.targetNodeId;
        const edge = await this.fabric.bindEdge({ ...e, sourceNodeId, targetNodeId });
        edges.push(edge);
      }
    } else {
      const nodeInput: MemoryNodeInput = {
        label: input.label ?? input.text.slice(0, 100),
        category: input.category ?? 'semantic',
        content: input.text,
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
        return duplicate;
      }
    }
    return this.fabric.createNode(input);
  }

  async bindEdge(input: MemoryEdgeInput): Promise<MemoryEdge> {
    return this.fabric.bindEdge(input);
  }

  async fireNeuron(nodeId: string): Promise<void> {
    return this.fabric.fireNeuron(nodeId);
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
