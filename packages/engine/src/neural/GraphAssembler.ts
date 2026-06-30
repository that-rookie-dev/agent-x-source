/**
 * GraphAssembler — Stage 5 of the StructuredMemoryPipeline.
 *
 * Takes extracted nodes + edges from the KnowledgeExtractor and:
 * 1. Scaffolds structural edges (CONTAINS, NEXT_STEP) deterministically.
 * 2. Enforces topology constraints (max edges per node via anti-hub relay).
 * 3. Calculates depth metrics.
 *
 * Deterministic ID assignment and fuzzy embedding merge are handled elsewhere;
 * this module focuses on topology.
 *
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §6 Stage 5 and §8 (Keep vs Replace).
 */
import type { MemoryNodeInput, MemoryEdgeInput } from './MemoryFabric.js';

export interface TopologyMetrics {
  totalNodes: number;
  totalEdges: number;
  maxDepth: number;
  avgEdgesPerNode: number;
  maxEdgesPerNode: number;
  violatesConstraints: boolean;
  violations: string[];
}

export interface AssembleOptions {
  /** Maximum outgoing edges per node (anti-centralization). Default: 7. */
  maxEdgesPerNode?: number;
  /** Minimum depth tiers. Default: 0 (no minimum enforced). */
  minDepthTiers?: number;
  /** Session/cluster id for relay node provenance. */
  clusterId?: string;
  /** Source id for relay node provenance. */
  sourceId?: string;
}

export interface AssembledGraph {
  nodes: MemoryNodeInput[];
  edges: MemoryEdgeInput[];
  topology: TopologyMetrics;
}

/**
 * Assemble the final graph from extracted nodes + edges.
 */
export function assembleGraph(
  nodes: MemoryNodeInput[],
  edges: MemoryEdgeInput[],
  options: AssembleOptions = {},
): AssembledGraph {
  const maxEdgesPerNode = options.maxEdgesPerNode ?? 7;
  const minDepthTiers = options.minDepthTiers ?? 0;

  const { nodes: finalNodes, edges: finalEdges, violations } = enforceTopologyConstraints(
    nodes,
    edges,
    maxEdgesPerNode,
    options,
  );

  const topology = calculateTopologyMetrics(finalNodes, finalEdges, violations, minDepthTiers);

  return { nodes: finalNodes, edges: finalEdges, topology };
}

/**
 * Enforce max-edges-per-node by spawning Sub-Context relay nodes for nodes
 * that exceed the limit. This is the anti-hub-relay pattern.
 */
function enforceTopologyConstraints(
  nodes: MemoryNodeInput[],
  edges: MemoryEdgeInput[],
  maxEdgesPerNode: number,
  options: AssembleOptions,
): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[]; violations: string[] } {
  const newNodes: MemoryNodeInput[] = [...nodes];
  const newEdges: MemoryEdgeInput[] = [];
  const violations: string[] = [];

  // Count outgoing edges per source node.
  const outgoingEdgeCount = new Map<string, number>();
  const nodeEdges = new Map<string, MemoryEdgeInput[]>();

  for (const edge of edges) {
    outgoingEdgeCount.set(edge.sourceNodeId, (outgoingEdgeCount.get(edge.sourceNodeId) ?? 0) + 1);
    const edgeList = nodeEdges.get(edge.sourceNodeId) ?? [];
    edgeList.push(edge);
    nodeEdges.set(edge.sourceNodeId, edgeList);
  }

  for (const [nodeId, count] of outgoingEdgeCount) {
    const edgeList = nodeEdges.get(nodeId) ?? [];

    if (count <= maxEdgesPerNode) {
      newEdges.push(...edgeList);
      continue;
    }

    violations.push(`Node ${nodeId} has ${count} edges, exceeds max ${maxEdgesPerNode}`);

    const originalNode = nodes.find((n) => n.id === nodeId);
    if (!originalNode) {
      newEdges.push(...edgeList);
      continue;
    }

    // Keep first (max-1) edges direct, relay the overflow through a sub-context node.
    const directEdges = edgeList.slice(0, maxEdgesPerNode - 1);
    const overflowEdges = edgeList.slice(maxEdgesPerNode - 1);

    const relayNode: MemoryNodeInput = {
      id: crypto.randomUUID(),
      label: `${originalNode.label} ext`.slice(0, 120),
      category: 'system',
      content: `Extension context for ${originalNode.label}`,
      sessionId: options.clusterId,
      sourceId: options.sourceId,
      unitType: 'relay',
    };
    newNodes.push(relayNode);

    newEdges.push({
      sourceNodeId: nodeId,
      targetNodeId: relayNode.id!,
      relationshipType: 'CONTAINS',
      weight: 1.0,
    });
    newEdges.push(...directEdges);
    for (const edge of overflowEdges) {
      newEdges.push({
        sourceNodeId: relayNode.id!,
        targetNodeId: edge.targetNodeId,
        relationshipType: edge.relationshipType,
        weight: edge.weight,
      });
    }
  }

  return { nodes: newNodes, edges: newEdges, violations };
}

/**
 * Calculate node depths via BFS along CONTAINS / PARENT_OF edges from roots.
 */
function calculateDepths(nodes: MemoryNodeInput[], edges: MemoryEdgeInput[]): Map<string, number> {
  const depths = new Map<string, number>();
  const childrenMap = new Map<string, string[]>();
  const hierarchyTypes = new Set(['CONTAINS', 'PARENT_OF']);

  for (const edge of edges) {
    if (hierarchyTypes.has(edge.relationshipType)) {
      const children = childrenMap.get(edge.sourceNodeId) ?? [];
      children.push(edge.targetNodeId);
      childrenMap.set(edge.sourceNodeId, children);
    }
  }

  const hasParent = new Set(
    edges.filter((e) => hierarchyTypes.has(e.relationshipType)).map((e) => e.targetNodeId),
  );
  const roots = nodes.filter((n) => n.id && !hasParent.has(n.id)).map((n) => n.id!);

  const queue: Array<{ id: string; depth: number }> = roots.map((id) => ({ id, depth: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    depths.set(id, depth);

    const children = childrenMap.get(id) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    }
  }

  for (const n of nodes) {
    if (n.id && !depths.has(n.id)) depths.set(n.id, 0);
  }

  return depths;
}

function calculateTopologyMetrics(
  nodes: MemoryNodeInput[],
  edges: MemoryEdgeInput[],
  violations: string[],
  minDepthTiers: number,
): TopologyMetrics {
  const depths = calculateDepths(nodes, edges);
  const maxDepth = Math.max(...Array.from(depths.values()), 0);

  if (minDepthTiers > 0 && maxDepth < minDepthTiers) {
    violations.push(`Max depth ${maxDepth} < minimum ${minDepthTiers}`);
  }

  const outgoingEdgeCount = new Map<string, number>();
  for (const edge of edges) {
    outgoingEdgeCount.set(edge.sourceNodeId, (outgoingEdgeCount.get(edge.sourceNodeId) ?? 0) + 1);
  }

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
