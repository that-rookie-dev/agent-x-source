/**
 * Graph walk helpers extracted from MemoryFabric (REFACTOR-5).
 *
 * Traverses memory_edges via recursive SQL CTEs. The MemoryFabric class
 * delegates to these to keep the main module focused on storage and retrieval.
 */
import type { Pool } from 'pg';
import type { GraphWalkOptions, GraphWalkResult } from './MemoryFabric.js';

/** Context required by the graph-walk helpers. */
export interface GraphWalkContext {
  pool: Pool;
}

export async function graphWalk(ctx: GraphWalkContext, options: GraphWalkOptions): Promise<GraphWalkResult> {
  const maxDepth = options.maxDepth ?? 3;
  const maxFanOut = options.maxFanOut ?? 10;
  const minWeight = options.minWeight ?? 0.1;
  const relationshipTypes = options.relationshipTypes ?? [];

  const { rows } = await ctx.pool.query<{
    node_id: string;
    source_node_id: string;
    target_node_id: string;
    relationship_type: string;
    weight: number;
  }>(
    `WITH RECURSIVE walk(path, node_id, depth, visited) AS (
       SELECT ARRAY[start_id]::uuid[], start_id::uuid, 1, ARRAY[start_id]::uuid[]
       FROM unnest($1::text[]) AS start_id
       UNION ALL
       SELECT w.path || e.target_node_id,
              e.target_node_id,
              w.depth + 1,
              w.visited || e.target_node_id
       FROM walk w
       JOIN LATERAL (
         SELECT e.*
         FROM memory_edges e
         WHERE e.source_node_id = w.node_id
           AND e.weight >= $3
           AND (array_length($4::text[], 1) IS NULL OR e.relationship_type = ANY($4::text[]))
         ORDER BY e.weight DESC
         LIMIT $5
       ) e ON true
       WHERE w.depth < $2
         AND NOT e.target_node_id = ANY(w.visited)
     )
     SELECT DISTINCT w.node_id::text AS node_id,
            e.source_node_id::text AS source_node_id, e.target_node_id::text AS target_node_id,
            e.relationship_type, e.weight
     FROM walk w
     LEFT JOIN memory_edges e ON e.source_node_id = w.node_id
     ORDER BY e.weight DESC NULLS LAST`,
    [
      options.startNodeIds,
      maxDepth,
      minWeight,
      relationshipTypes,
      maxFanOut,
    ],
  );

  const nodeIds = [...new Set(rows.map((r) => r.node_id))];
  const edges = rows
    .filter((r) => r.source_node_id)
    .map((r) => ({
      sourceNodeId: r.source_node_id,
      targetNodeId: r.target_node_id,
      relationshipType: r.relationship_type,
      weight: r.weight,
    }));

  return { nodeIds, edges };
}

export async function walkGraph(ctx: GraphWalkContext, options: GraphWalkOptions): Promise<GraphWalkResult> {
  const startIds = options.startNodeIds;
  if (startIds.length === 0) return { nodeIds: [], edges: [] };
  const maxDepth = options.maxDepth ?? 3;
  const maxFanOut = options.maxFanOut ?? 50;
  const minWeight = options.minWeight ?? 0;
  const relTypes = options.relationshipTypes?.length ? options.relationshipTypes : undefined;
  const relFilter = relTypes ? `AND relationship_type IN (${relTypes.map((t) => `'${t}'`).join(',')})` : '';

  const { rows } = await ctx.pool.query<{ id: string; sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number }>(
    `WITH RECURSIVE walk AS (
      SELECT e.id, e.source_node_id AS "sourceNodeId", e.target_node_id AS "targetNodeId",
             e.relationship_type AS "relationshipType", e.weight, 1 AS depth
      FROM memory_edges e
      WHERE e.source_node_id = ANY($1::uuid[]) AND e.weight >= $2 ${relFilter}
      UNION
      SELECT e.id, e.source_node_id, e.target_node_id, e.relationship_type, e.weight, w.depth + 1
      FROM memory_edges e
      JOIN walk w ON e.source_node_id = w."targetNodeId"
      WHERE w.depth < $3 AND e.weight >= $2 ${relFilter}
    )
    SELECT DISTINCT id, "sourceNodeId", "targetNodeId", "relationshipType", weight FROM walk LIMIT $4`,
    [startIds, minWeight, maxDepth, maxFanOut],
  );
  const nodeIds = new Set<string>(startIds);
  const edges: GraphWalkResult['edges'] = [];
  for (const row of rows) {
    nodeIds.add(row.sourceNodeId);
    nodeIds.add(row.targetNodeId);
    edges.push({ sourceNodeId: row.sourceNodeId, targetNodeId: row.targetNodeId, relationshipType: row.relationshipType, weight: row.weight });
  }
  return { nodeIds: Array.from(nodeIds), edges };
}
