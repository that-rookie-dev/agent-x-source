/**
 * Layout / community helpers extracted from MemoryFabric (REFACTOR-5).
 *
 * Standalone functions for viewport queries, Louvain community detection,
 * ForceAtlas2 layout, and community-based retrieval. The MemoryFabric class
 * delegates to these to keep the main module focused on storage.
 */
import type { Pool } from 'pg';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type {
  MemoryNode,
  MemoryEdge,
  MemoryNodeCategory,
} from './MemoryFabric.js';

/** Context required by the layout/community helpers. */
export interface LayoutContext {
  pool: Pool;
  /** Snapshot of active nodes/edges (provided by MemoryFabric.getGraphSnapshot). */
  getGraphSnapshot: (options: {
    limit?: number;
    category?: MemoryNodeCategory;
    tag?: string;
    isBenchmark?: boolean;
    sourceId?: string;
  }) => Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[] }>;
  /** Count of active nodes (provided by MemoryFabric.getNodeCount). */
  getNodeCount: () => Promise<number>;
}

export async function updateLayout(
  ctx: LayoutContext,
  nodeId: string,
  x: number,
  y: number,
  layoutEpoch: number,
): Promise<void> {
  await ctx.pool.query(
    `UPDATE memory_nodes SET x = $1, y = $2, layout_epoch = $3, updated_at = NOW() WHERE id = $4`,
    [x, y, layoutEpoch, nodeId],
  );
}

export async function getNodesInViewport(
  ctx: LayoutContext,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  options: { category?: MemoryNodeCategory; limit?: number } = {},
): Promise<MemoryNode[]> {
  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.x BETWEEN $1 AND $2
       AND n.y BETWEEN $3 AND $4
       AND n.status = 'active'
       ${options.category ? `AND n.category = '${options.category}'` : ''}
     ORDER BY n.updated_at DESC
     LIMIT $5`,
    [xMin, xMax, yMin, yMax, options.limit ?? 1000],
  );
  return rows;
}

export async function getLayoutEpoch(ctx: LayoutContext): Promise<number> {
  const { rows } = await ctx.pool.query<{ maxEpoch: number }>(
    `SELECT COALESCE(MAX(layout_epoch), 0) AS "maxEpoch" FROM memory_nodes`,
  );
  return rows[0]?.maxEpoch ?? 0;
}

/**
 * Server-side Louvain community detection + ForceAtlas2 layout.
 * Updates node x/y coordinates and bumps the layout epoch.
 * Returns the new epoch and the number of nodes laid out.
 */
export async function computeLouvainLayout(ctx: LayoutContext): Promise<{ epoch: number; count: number; communities: number }> {
  const { rows } = await ctx.pool.query<{ maxEpoch: number }>(
    `SELECT COALESCE(MAX(layout_epoch), 0) + 1 AS "maxEpoch" FROM memory_nodes`,
  );
  const epoch = rows[0]?.maxEpoch ?? 1;

  const { nodes, edges } = await ctx.getGraphSnapshot({ limit: 5000 });
  if (nodes.length === 0) return { epoch, count: 0, communities: 0 };

  const graph = new Graph();

  // Group nodes by session so each session starts as its own local nebula.
  const sessionGroups = new Map<string, MemoryNode[]>();
  const noSessionNodes: MemoryNode[] = [];
  for (const n of nodes) {
    if (n.sessionId) {
      const group = sessionGroups.get(n.sessionId) ?? [];
      group.push(n);
      sessionGroups.set(n.sessionId, group);
    } else {
      noSessionNodes.push(n);
    }
  }

  const sessionIds = Array.from(sessionGroups.keys());
  const sessionRadius = 100;
  const sessionAngleStep = sessionIds.length > 0 ? (2 * Math.PI) / sessionIds.length : 0;

  for (let i = 0; i < sessionIds.length; i++) {
    const sessionId = sessionIds[i]!;
    const group = sessionGroups.get(sessionId);
    if (!group) continue;
    const centerX = Math.cos(i * sessionAngleStep) * sessionRadius;
    const centerY = Math.sin(i * sessionAngleStep) * sessionRadius;
    for (let j = 0; j < group.length; j++) {
      const n = group[j];
      if (!n) continue;
      const angle = (j / Math.max(group.length, 1)) * 2 * Math.PI;
      const radius = 15 + Math.random() * 25;
      graph.addNode(n.id, {
        label: n.label,
        category: n.category,
        sessionId: n.sessionId,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }
  }

  // Nodes without a session are scattered around the center.
  for (let i = 0; i < noSessionNodes.length; i++) {
    const n = noSessionNodes[i];
    if (!n) continue;
    const angle = (i / Math.max(noSessionNodes.length, 1)) * 2 * Math.PI;
    const radius = 15 + Math.random() * 50;
    graph.addNode(n.id, {
      label: n.label,
      category: n.category,
      sessionId: n.sessionId,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }

  for (const e of edges) {
    if (graph.hasNode(e.sourceNodeId) && graph.hasNode(e.targetNodeId)) {
      graph.addEdge(e.sourceNodeId, e.targetNodeId, { weight: e.weight });
    }
  }

  louvain.assign(graph, { getEdgeWeight: 'weight' });
  const communities = new Set<string>();
  graph.forEachNode((_node: string, attrs: { community?: string | number }) => communities.add(String(attrs.community)));

  const positions = forceAtlas2(graph, {
    iterations: 200,
    settings: {
      gravity: 0.15,
      scalingRatio: 1.2,
      strongGravityMode: true,
      slowDown: 1.5,
      barnesHutOptimize: true,
      adjustSizes: true,
    },
  });

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    for (const [nodeId, pos] of Object.entries(positions)) {
      const community = graph.getNodeAttribute(nodeId, 'community');
      await client.query(
        `UPDATE memory_nodes SET x = $1, y = $2, layout_epoch = $3, community_id = $4, updated_at = NOW() WHERE id = $5`,
        [pos.x, pos.y, epoch, community != null ? String(community) : null, nodeId],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { epoch, count: nodes.length, communities: communities.size };
}

/**
 * Get all distinct community IDs with their member counts.
 * Used by the CommunitySummarizer to decide which communities need summarization.
 */
export async function getCommunities(ctx: LayoutContext): Promise<{ communityId: string; memberCount: number }[]> {
  const { rows } = await ctx.pool.query<{ communityId: string; memberCount: number }>(
    `SELECT community_id AS "communityId", COUNT(*)::int AS "memberCount"
     FROM memory_nodes
     WHERE community_id IS NOT NULL AND status = 'active'
     GROUP BY community_id
     ORDER BY memberCount DESC`,
  );
  return rows;
}

/**
 * Get all nodes in a specific community (for summarization).
 */
export async function getCommunityMembers(ctx: LayoutContext, communityId: string, limit = 100): Promise<MemoryNode[]> {
  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            n.community_id AS "communityId"
     FROM memory_nodes n
     WHERE n.community_id = $1 AND n.status = 'active'
     ORDER BY n.confidence DESC, COALESCE(n.access_count, 0) DESC
     LIMIT $2`,
    [communityId, limit],
  );
  return rows;
}

/**
 * Find community summary nodes whose embeddings are closest to the query.
 * Used as the "global pass" in GraphRAG hierarchical retrieval.
 */
export async function searchCommunitySummaries(ctx: LayoutContext, embedding: number[], limit = 3): Promise<MemoryNode[]> {
  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            n.embedding <=> $1::vector AS distance
     FROM memory_nodes n
     WHERE n.tag = 'community_summary'
       AND n.embedding IS NOT NULL
       AND n.status = 'active'
     ORDER BY n.embedding <=> $1::vector
     LIMIT $2`,
    [`[${embedding.join(',')}]`, limit],
  );
  return rows;
}

/**
 * Get all nodes in the communities identified by the given community IDs.
 * Used to expand from community summaries to their member nodes.
 */
export async function getNodesInCommunities(ctx: LayoutContext, communityIds: string[], limit = 50): Promise<MemoryNode[]> {
  if (communityIds.length === 0) return [];
  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            n.community_id AS "communityId"
     FROM memory_nodes n
     WHERE n.community_id = ANY($1::text[])
       AND n.status = 'active'
       AND n.tag != 'community_summary'
     ORDER BY n.confidence DESC
     LIMIT $2`,
    [communityIds, limit],
  );
  return rows;
}

export async function getViewport(
  ctx: LayoutContext,
  bounds: { xmin: number; xmax: number; ymin: number; ymax: number },
  options: { zoom?: number; category?: MemoryNodeCategory; limit?: number } = {},
): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[]; epoch: number; band: 'A' | 'B' | 'C' }> {
  const { xmin, xmax, ymin, ymax } = bounds;
  const zoom = options.zoom ?? 1;
  const limit = options.limit ?? 2000;
  const density = await ctx.getNodeCount();
  let band: 'A' | 'B' | 'C' = 'A';
  if (zoom < 0.3 && density > 1000) band = 'C';
  else if (zoom < 0.7 && density > 500) band = 'B';

  const { rows: nodes } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.status = 'active'
       AND n.x BETWEEN $1 AND $2
       AND n.y BETWEEN $3 AND $4
       ${options.category ? `AND n.category = '${options.category}'` : ''}
     ORDER BY COALESCE(a.access_count, 0) DESC
     LIMIT $5`,
    [xmin, xmax, ymin, ymax, limit],
  );

  const nodeIds = new Set(nodes.map((n) => n.id));
  const { rows: edges } = await ctx.pool.query<MemoryEdge>(
    `SELECT id, source_node_id AS "sourceNodeId", target_node_id AS "targetNodeId", relationship_type AS "relationshipType", weight, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM memory_edges
     WHERE source_node_id = ANY($1::uuid[]) AND target_node_id = ANY($1::uuid[])
     LIMIT $2`,
    [Array.from(nodeIds), limit * 2],
  );

  const epoch = await getLayoutEpoch(ctx);
  return { nodes, edges, epoch, band };
}
