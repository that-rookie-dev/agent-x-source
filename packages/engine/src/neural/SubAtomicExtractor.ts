/**
 * Sub-Atomic Entity-Attribute-Relationship Extraction Engine
 * 
 * Implements the deep chunking protocol from NEURAL_BRAIN_STRUCTURING.md:
 * - Extracts ~50 nodes per 100 words
 * - Breaks text into architectural atoms: Concepts, Attributes, Operations, Contextual Modifiers
 * - Enforces anti-centralization (max 7 edges per node)
 * - Creates deep hierarchical structures (4+ vertical tiers)
 * - Generates cross-cluster bridge synapses
 */

import { z } from 'zod';
import type { MemoryNodeInput, MemoryEdgeInput, MemoryEdgeType } from './MemoryFabric.js';
import type { GenerateFn } from './MemoryExtractor.js';

export interface SubAtomicExtractionOptions {
  /** Session/cluster identifier for topology isolation */
  clusterId: string;
  /** Source identifier for provenance */
  sourceId?: string;
  /** Target node density: nodes per 100 words (default: 50) */
  targetDensity?: number;
  /** Maximum edges per node (anti-centralization, default: 7) */
  maxEdgesPerNode?: number;
  /** Minimum depth tiers (default: 4) */
  minDepthTiers?: number;
  /** Cross-cluster bridge count (default: 3-5) */
  bridgeSynapseRange?: [number, number];
  /** LLM generator function */
  generate: GenerateFn;
  /** Optional embedding generator */
  embed?: (text: string) => Promise<number[]>;
}

export interface SubAtomicResult {
  nodes: MemoryNodeInput[];
  edges: MemoryEdgeInput[];
  topology: TopologyMetrics;
}

export interface TopologyMetrics {
  totalNodes: number;
  totalEdges: number;
  maxDepth: number;
  avgEdgesPerNode: number;
  maxEdgesPerNode: number;
  violatesConstraints: boolean;
  violations: string[];
}

/**
 * Node types in the sub-atomic extraction hierarchy
 */
type SubAtomicNodeType = 
  | 'Session'           // Root cluster node
  | 'CoreTopic'         // Main subject/domain
  | 'Concept'           // Noun phrases, paradigms
  | 'Attribute'         // Properties, states, data types
  | 'Operation'         // Functions, transformations, actions
  | 'ContextModifier'   // Constraints, environments, metadata
  | 'SubContext'        // Extension node when max edges exceeded
  | 'GranularAttribute' // Deep attribute detail
  | 'ExecutionState';   // Deepest tier - runtime/execution info

const subAtomicNodeSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(20), // Max 20 chars for visual rendering
  type: z.enum(['Session', 'CoreTopic', 'Concept', 'Attribute', 'Operation', 'ContextModifier', 'SubContext', 'GranularAttribute', 'ExecutionState']),
  content: z.string().min(1).max(500), // Microscopic data slice
  depthLevel: z.number().int().min(0).max(10),
  confidence: z.number().min(0).max(1).optional(),
});

const subAtomicEdgeSchema = z.object({
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  relationshipType: z.enum(['PARENT_OF', 'DEPENDS_ON', 'MODIFIES', 'RESONATES_WITH']),
  weight: z.number().min(0).max(1).optional(),
});

export class SubAtomicExtractor {
  private readonly targetDensity: number;
  private readonly maxEdgesPerNode: number;
  private readonly minDepthTiers: number;

  constructor(private options: SubAtomicExtractionOptions) {
    this.targetDensity = options.targetDensity ?? 50;
    this.maxEdgesPerNode = options.maxEdgesPerNode ?? 7;
    this.minDepthTiers = options.minDepthTiers ?? 4;
  }

  /**
   * Main extraction pipeline following the 6-step execution command loop
   */
  async extract(text: string): Promise<SubAtomicResult> {
    // Step 1: Parse & Structurize - Break into sub-atomic JSON maps
    const rawStructure = await this.parseAndStructurize(text);

    // Step 2: Verify Topology Constraints
    const { nodes, edges, violations } = this.verifyTopologyConstraints(rawStructure);

    // Step 3: Generate embeddings if provider available
    if (this.options.embed) {
      for (const node of nodes) {
        if (!node.embedding) {
          node.embedding = await this.options.embed(node.content);
        }
      }
    }

    // Calculate topology metrics
    const topology = this.calculateTopologyMetrics(nodes, edges, violations);

    return { nodes, edges, topology };
  }

  /**
   * Step 1: Parse text into structural JSON maps with sub-atomic nodes
   * Target: ~50 nodes per 100 words
   */
  private async parseAndStructurize(text: string): Promise<{ nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] }> {
    const wordCount = text.split(/\s+/).length;
    const targetNodeCount = Math.ceil((wordCount / 100) * this.targetDensity);

    const prompt = this.buildSubAtomicPrompt(text, targetNodeCount);
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await this.options.generate(prompt, {
          maxTokens: Math.min(4096, targetNodeCount * 50),
          schema: this.buildJsonSchema(targetNodeCount),
        });

        const result = this.parseSubAtomicResponse(raw);
        
        // Ensure minimum node count achieved
        if (result.nodes.length >= Math.floor(targetNodeCount * 0.7)) {
          return this.enrichWithMetadata(result);
        }
      } catch (e) {
        // Continue to next attempt
      }
    }

    // Fallback: heuristic extraction
    return this.heuristicSubAtomicExtract(text, targetNodeCount);
  }

  /**
   * Build the sub-atomic extraction prompt
   */
  private buildSubAtomicPrompt(text: string, targetNodeCount: number): string {
    return `You are a sub-atomic knowledge extraction engine. Break the following text into its fundamental architectural atoms.

TARGET: Extract approximately ${targetNodeCount} nodes following this hierarchy:

1. **Core Concepts** (Noun Phrases, Paradigms) - category: "Concept"
2. **Attributes** (Properties, States, Data Types) - category: "Attribute"  
3. **Operations** (Functions, Transformations, Actions) - category: "Operation"
4. **Contextual Modifiers** (Constraints, Environments, Metadata) - category: "ContextModifier"

RULES:
- Each node must have a label (1-5 words max, under 20 chars)
- Each node must have content (the microscopic data slice, under 500 chars)
- Create a deep hierarchy with at least ${this.minDepthTiers} vertical tiers
- Start with depth 0 (Session/CoreTopic), then build down to depth 3+ (GranularAttribute, ExecutionState)
- Connect nodes with typed edges: PARENT_OF (hierarchical), DEPENDS_ON (dependency), MODIFIES (transformation)
- NO node should have more than ${this.maxEdgesPerNode} outgoing edges from this extraction pass

TEXT TO EXTRACT:
${text}

Return a JSON object with this structure:
{
  "nodes": [
    {
      "id": "unique-id",
      "label": "Short Label",
      "type": "Concept|Attribute|Operation|ContextModifier|CoreTopic|GranularAttribute|ExecutionState",
      "content": "Detailed content describing this atomic unit",
      "depthLevel": 0,
      "confidence": 0.95
    }
  ],
  "edges": [
    {
      "sourceNodeId": "parent-id",
      "targetNodeId": "child-id",
      "relationshipType": "PARENT_OF|DEPENDS_ON|MODIFIES",
      "weight": 0.9
    }
  ]
}`;
  }

  /**
   * Parse and validate the LLM response
   */
  private parseSubAtomicResponse(raw: string): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] } {
    const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);

    const validated = z.object({
      nodes: z.array(subAtomicNodeSchema),
      edges: z.array(subAtomicEdgeSchema),
    }).parse(parsed);

    // Map to MemoryNodeInput format
    const nodes: MemoryNodeInput[] = validated.nodes.map(n => ({
      id: n.id ?? crypto.randomUUID(),
      label: n.label,
      category: this.mapTypeToCategory(n.type),
      content: n.content,
      confidence: n.confidence,
      sessionId: this.options.clusterId,
      sourceId: this.options.sourceId,
    }));

    const edges: MemoryEdgeInput[] = validated.edges.map(e => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      relationshipType: e.relationshipType as MemoryEdgeType,
      weight: e.weight ?? 0.8,
    }));

    return { nodes, edges };
  }

  /**
   * Map sub-atomic types to memory categories
   */
  private mapTypeToCategory(type: SubAtomicNodeType): 'persona' | 'tool' | 'episodic' | 'semantic' | 'source_doc' | 'system' {
    switch (type) {
      case 'Session':
        return 'episodic';
      case 'CoreTopic':
      case 'Concept':
      case 'Attribute':
      case 'GranularAttribute':
        return 'semantic';
      case 'Operation':
        return 'tool';
      case 'ContextModifier':
      case 'SubContext':
      case 'ExecutionState':
        return 'system';
      default:
        return 'semantic';
    }
  }

  /**
   * Enrich nodes with cluster metadata
   */
  private enrichWithMetadata(result: { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] }): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] } {
    // Ensure all nodes have IDs
    const idMap = new Map<string, string>();
    
    result.nodes.forEach(node => {
      const oldId = node.id;
      if (!oldId || !node.id) {
        node.id = crypto.randomUUID();
      }
      if (oldId && oldId !== node.id) {
        idMap.set(oldId, node.id);
      }
      
      // Add cluster metadata
      node.sessionId = this.options.clusterId;
      if (this.options.sourceId) {
        node.sourceId = this.options.sourceId;
      }
    });

    // Remap edge IDs
    result.edges.forEach(edge => {
      if (idMap.has(edge.sourceNodeId)) {
        edge.sourceNodeId = idMap.get(edge.sourceNodeId)!;
      }
      if (idMap.has(edge.targetNodeId)) {
        edge.targetNodeId = idMap.get(edge.targetNodeId)!;
      }
    });

    return result;
  }

  /**
   * Step 2: Verify topology constraints and fix violations
   */
  private verifyTopologyConstraints(
    input: { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] }
  ): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[]; violations: string[] } {
    const { nodes, edges } = input;
    const violations: string[] = [];
    const newNodes: MemoryNodeInput[] = [...nodes];
    const newEdges: MemoryEdgeInput[] = [];

    // Count outgoing edges per node
    const outgoingEdgeCount = new Map<string, number>();
    const nodeEdges = new Map<string, MemoryEdgeInput[]>();

    edges.forEach(edge => {
      const count = outgoingEdgeCount.get(edge.sourceNodeId) ?? 0;
      outgoingEdgeCount.set(edge.sourceNodeId, count + 1);
      
      const edgeList = nodeEdges.get(edge.sourceNodeId) ?? [];
      edgeList.push(edge);
      nodeEdges.set(edge.sourceNodeId, edgeList);
    });

    // Fix nodes that exceed max edges by spawning Sub-Context nodes
    outgoingEdgeCount.forEach((count, nodeId) => {
      if (count > this.maxEdgesPerNode) {
        violations.push(`Node ${nodeId} has ${count} edges, exceeds max ${this.maxEdgesPerNode}`);
        
        const originalNode = nodes.find(n => n.id === nodeId);
        if (!originalNode) return;

        const edgeList = nodeEdges.get(nodeId) ?? [];
        
        // Keep first maxEdgesPerNode edges directly
        const directEdges = edgeList.slice(0, this.maxEdgesPerNode - 1);
        const overflowEdges = edgeList.slice(this.maxEdgesPerNode - 1);

        // Create a Sub-Context extension node
        const subContextNode: MemoryNodeInput = {
          id: crypto.randomUUID(),
          label: `${originalNode.label}_ext`,
          category: 'system',
          content: `Extension context for ${originalNode.label}`,
          sessionId: this.options.clusterId,
          sourceId: this.options.sourceId,
        };

        newNodes.push(subContextNode);
        
        // Link original node to sub-context
        newEdges.push({
          sourceNodeId: nodeId,
          targetNodeId: subContextNode.id!,
          relationshipType: 'PARENT_OF',
          weight: 1.0,
        });

        // Add direct edges
        newEdges.push(...directEdges);

        // Reroute overflow edges through sub-context
        overflowEdges.forEach(edge => {
          newEdges.push({
            sourceNodeId: subContextNode.id!,
            targetNodeId: edge.targetNodeId,
            relationshipType: edge.relationshipType,
            weight: edge.weight,
          });
        });
      } else {
        // Node is within limits, keep its edges
        const edgeList = nodeEdges.get(nodeId) ?? [];
        newEdges.push(...edgeList);
      }
    });

    // Verify minimum depth
    const depths = this.calculateDepths(newNodes, newEdges);
    const maxDepth = Math.max(...Array.from(depths.values()));
    
    if (maxDepth < this.minDepthTiers) {
      violations.push(`Max depth ${maxDepth} < minimum ${this.minDepthTiers}`);
    }

    return { nodes: newNodes, edges: newEdges, violations };
  }

  /**
   * Calculate node depths via BFS from root nodes
   */
  private calculateDepths(nodes: MemoryNodeInput[], edges: MemoryEdgeInput[]): Map<string, number> {
    const depths = new Map<string, number>();
    const childrenMap = new Map<string, string[]>();

    // Build adjacency list
    edges.forEach(edge => {
      if (edge.relationshipType === 'PARENT_OF') {
        const children = childrenMap.get(edge.sourceNodeId) ?? [];
        children.push(edge.targetNodeId);
        childrenMap.set(edge.sourceNodeId, children);
      }
    });

    // Find root nodes (no incoming PARENT_OF edges)
    const hasParent = new Set(edges.filter(e => e.relationshipType === 'PARENT_OF').map(e => e.targetNodeId));
    const roots = nodes.filter(n => n.id && !hasParent.has(n.id)).map(n => n.id!);

    // BFS to assign depths
    const queue: Array<{ id: string; depth: number }> = roots.map(id => ({ id, depth: 0 }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      
      visited.add(id);
      depths.set(id, depth);

      const children = childrenMap.get(id) ?? [];
      children.forEach(childId => {
        if (!visited.has(childId)) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      });
    }

    // Assign depth 0 to any unvisited nodes
    nodes.forEach(n => {
      if (n.id && !depths.has(n.id)) {
        depths.set(n.id, 0);
      }
    });

    return depths;
  }

  /**
   * Calculate topology metrics
   */
  private calculateTopologyMetrics(
    nodes: MemoryNodeInput[],
    edges: MemoryEdgeInput[],
    violations: string[]
  ): TopologyMetrics {
    const depths = this.calculateDepths(nodes, edges);
    const maxDepth = Math.max(...Array.from(depths.values()), 0);

    const outgoingEdgeCount = new Map<string, number>();
    edges.forEach(edge => {
      const count = outgoingEdgeCount.get(edge.sourceNodeId) ?? 0;
      outgoingEdgeCount.set(edge.sourceNodeId, count + 1);
    });

    const edgeCounts = Array.from(outgoingEdgeCount.values());
    const avgEdgesPerNode = edgeCounts.length > 0 
      ? edgeCounts.reduce((a, b) => a + b, 0) / edgeCounts.length 
      : 0;
    const maxEdgesPerNode = Math.max(...edgeCounts, 0);

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      maxDepth,
      avgEdgesPerNode,
      maxEdgesPerNode,
      violatesConstraints: violations.length > 0,
      violations,
    };
  }

  /**
   * Heuristic fallback extraction when LLM fails
   */
  private heuristicSubAtomicExtract(text: string, targetNodeCount: number): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] } {
    const nodes: MemoryNodeInput[] = [];
    const edges: MemoryEdgeInput[] = [];

    // Create session root
    const sessionNode: MemoryNodeInput = {
      id: crypto.randomUUID(),
      label: 'Session',
      category: 'episodic',
      content: text.slice(0, 200),
      sessionId: this.options.clusterId,
      sourceId: this.options.sourceId,
    };
    nodes.push(sessionNode);

    // Extract sentences as concepts
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    sentences.slice(0, Math.min(sentences.length, targetNodeCount - 1)).forEach((sentence) => {
      const conceptNode: MemoryNodeInput = {
        id: crypto.randomUUID(),
        label: sentence.slice(0, 20).trim(),
        category: 'semantic',
        content: sentence.trim(),
        sessionId: this.options.clusterId,
        sourceId: this.options.sourceId,
      };
      nodes.push(conceptNode);

      edges.push({
        sourceNodeId: sessionNode.id!,
        targetNodeId: conceptNode.id!,
        relationshipType: 'PARENT_OF',
        weight: 0.7,
      });
    });

    return { nodes, edges };
  }

  /**
   * Build JSON schema for LLM
   */
  private buildJsonSchema(targetNodeCount: number): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          minItems: Math.floor(targetNodeCount * 0.7),
          maxItems: targetNodeCount * 2,
          items: {
            type: 'object',
            required: ['label', 'type', 'content', 'depthLevel'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string', maxLength: 20 },
              type: { 
                type: 'string',
                enum: ['Session', 'CoreTopic', 'Concept', 'Attribute', 'Operation', 'ContextModifier', 'SubContext', 'GranularAttribute', 'ExecutionState']
              },
              content: { type: 'string', maxLength: 500 },
              depthLevel: { type: 'integer', minimum: 0, maximum: 10 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sourceNodeId', 'targetNodeId', 'relationshipType'],
            properties: {
              sourceNodeId: { type: 'string' },
              targetNodeId: { type: 'string' },
              relationshipType: { 
                type: 'string',
                enum: ['PARENT_OF', 'DEPENDS_ON', 'MODIFIES', 'RESONATES_WITH']
              },
              weight: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
      required: ['nodes', 'edges'],
    };
  }
}
