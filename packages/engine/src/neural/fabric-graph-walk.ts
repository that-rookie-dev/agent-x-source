/**
 * Graph walk helpers extracted from MemoryFabric (REFACTOR-5).
 *
 * Standalone functions that implement Apache AGE / recursive-CTE graph
 * traversal. The MemoryFabric class delegates to these to keep the main
 * module focused on storage and retrieval.
 */
import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { MemoryMigrationRunner } from './MemoryMigrationRunner.js';
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

  // Try Apache AGE first; fall back to recursive CTE if AGE is unavailable.
  try {
    await ctx.pool.query('SET search_path = ag_catalog, public');
    const idsParam = options.startNodeIds.map((id) => `'${id}'`).join(',');
    const relFilter = relationshipTypes.length ? `AND e.relationship_type IN (${relationshipTypes.map((t) => `'${t}'`).join(',')})` : '';
    const cypher = `
      SELECT * FROM ag_catalog.cypher('memory_graph', $$
        MATCH p = (n)-[e*1..${maxDepth}]->(m)
        WHERE id(n) IN [${idsParam}]
          ${relFilter.replace(/e\./g, '')}
        RETURN DISTINCT id(n) AS source_node_id, id(m) AS target_node_id, 'REACHABLE' AS relationship_type, 1.0 AS weight
        LIMIT ${maxFanOut}
      $$) AS (source_node_id agtype, target_node_id agtype, relationship_type agtype, weight agtype)
    `;
    const { rows } = await ctx.pool.query<{
      source_node_id: string;
      target_node_id: string;
      relationship_type: string;
      weight: number;
    }>(cypher);
    const nodeIds = new Set<string>(options.startNodeIds);
    const edges: GraphWalkResult['edges'] = [];
    for (const row of rows) {
      const s = String(row.source_node_id).replace(/"/g, '');
      const t = String(row.target_node_id).replace(/"/g, '');
      nodeIds.add(s);
      nodeIds.add(t);
      edges.push({ sourceNodeId: s, targetNodeId: t, relationshipType: String(row.relationship_type), weight: Number(row.weight) });
    }
    // AGE graph may exist but be empty (not synced). Fall back to CTE if no paths found.
    if (edges.length > 0) {
      return { nodeIds: Array.from(nodeIds), edges };
    }
  } catch {
    // Relational CTE fallback
  }

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

/**
 * Dual-path parity test: compare Apache AGE Cypher traversal against the
 * relational recursive-CTE implementation for the same start nodes.
 * Returns a mismatch report; empty diffs mean the paths agree.
 */
export async function runGraphWalkParityTest(
  ctx: GraphWalkContext,
  options: GraphWalkOptions,
): Promise<{ ageAvailable: boolean; ageResult: GraphWalkResult; cteResult: GraphWalkResult; nodeDiff: string[]; edgeDiff: string[]; passed: boolean }> {
  const runner = new MemoryMigrationRunner(ctx.pool);
  const { available: ageAvailable } = await runner.detectAge();
  let ageResult: GraphWalkResult = { nodeIds: [], edges: [] };
  if (ageAvailable) {
    try {
      ageResult = await graphWalkAge(ctx, options);
    } catch (e) {
      getLogger().warn('MEMORY_PARITY_TEST', `AGE path failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  const cteResult = await graphWalkCte(ctx, options);

  const ageNodes = new Set(ageResult.nodeIds);
  const cteNodes = new Set(cteResult.nodeIds);
  const nodeDiff = [
    ...new Set([...ageNodes].filter((id) => !cteNodes.has(id))),
    ...new Set([...cteNodes].filter((id) => !ageNodes.has(id))),
  ];

  const edgeKey = (e: GraphWalkResult['edges'][number]) => `${e.sourceNodeId}-${e.targetNodeId}-${e.relationshipType}`;
  const ageEdges = new Set(ageResult.edges.map(edgeKey));
  const cteEdges = new Set(cteResult.edges.map(edgeKey));
  const edgeDiff = [
    ...ageResult.edges.filter((e) => !cteEdges.has(edgeKey(e))).map(edgeKey),
    ...cteResult.edges.filter((e) => !ageEdges.has(edgeKey(e))).map(edgeKey),
  ];

  return { ageAvailable, ageResult, cteResult, nodeDiff, edgeDiff, passed: nodeDiff.length === 0 && edgeDiff.length === 0 };
}

export async function graphWalkAge(ctx: GraphWalkContext, options: GraphWalkOptions): Promise<GraphWalkResult> {
  const maxDepth = options.maxDepth ?? 3;
  const maxFanOut = options.maxFanOut ?? 10;
  const relationshipTypes = options.relationshipTypes ?? [];
  const idsParam = options.startNodeIds.map((id) => `'${id}'`).join(',');
  const relFilter = relationshipTypes.length ? `AND e.relationship_type IN (${relationshipTypes.map((t) => `'${t}'`).join(',')})` : '';
  const cypher = `
    SELECT * FROM cypher('memory_graph', $$
      MATCH p = (n)-[*1..${maxDepth}]->(m)
      WHERE id(n) IN [${idsParam}]
        ${relFilter.replace(/e\./g, '')}
      RETURN DISTINCT id(n) AS source_node_id, id(m) AS target_node_id, 'REACHABLE' AS relationship_type, 1.0 AS weight
      LIMIT ${maxFanOut}
    $$) AS (source_node_id agtype, target_node_id agtype, relationship_type agtype, weight agtype)
  `;
  await ctx.pool.query('SET search_path = ag_catalog, public');
  const { rows } = await ctx.pool.query<{ source_node_id: string; target_node_id: string; relationship_type: string; weight: number }>(cypher);
  const nodeIds = new Set<string>(options.startNodeIds);
  const edges: GraphWalkResult['edges'] = [];
  for (const row of rows) {
    const s = String(row.source_node_id).replace(/^"|"$/g, '');
    const t = String(row.target_node_id).replace(/^"|"$/g, '');
    nodeIds.add(s);
    nodeIds.add(t);
    edges.push({ sourceNodeId: s, targetNodeId: t, relationshipType: String(row.relationship_type), weight: Number(row.weight) });
  }
  return { nodeIds: Array.from(nodeIds), edges };
}

export async function graphWalkCte(ctx: GraphWalkContext, options: GraphWalkOptions): Promise<GraphWalkResult> {
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
    [options.startNodeIds, maxDepth, minWeight, relationshipTypes, maxFanOut],
  );
  const nodeIds = [...new Set(rows.map((r) => r.node_id))];
  const edges = rows
    .filter((r) => r.source_node_id)
    .map((r) => ({ sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id, relationshipType: r.relationship_type, weight: r.weight }));
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

  try {
    await ctx.pool.query('SET search_path = ag_catalog, public');
    const idsParam = startIds.map((id) => `'${id}'`).join(',');
    const cypher = `
      SELECT * FROM ag_catalog.cypher('memory_graph', $$
        MATCH p = (n)-[*1..${maxDepth}]->(m)
        WHERE id(n) IN [${idsParam}]
        RETURN DISTINCT id(n) AS source_id, id(m) AS target_id, 'REACHABLE' AS relationship_type, 1.0 AS weight
        LIMIT ${maxFanOut}
      $$) AS (source_id agtype, target_id agtype, relationship_type agtype, weight agtype)
    `;
    const { rows } = await ctx.pool.query<{ source_id: string; target_id: string; relationship_type: string; weight: number }>(cypher);
    const nodeIds = new Set<string>(startIds);
    const edges: GraphWalkResult['edges'] = [];
    for (const row of rows) {
      const s = String(row.source_id).replace(/"/g, '');
      const t = String(row.target_id).replace(/"/g, '');
      nodeIds.add(s);
      nodeIds.add(t);
      edges.push({ sourceNodeId: s, targetNodeId: t, relationshipType: String(row.relationship_type), weight: Number(row.weight) });
    }
    if (edges.length > 0) {
      return { nodeIds: Array.from(nodeIds), edges };
    }
  } catch {
    // AGE unavailable; fall through to CTE below.
  }

  // Relational CTE fallback (also used when AGE graph is empty).
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
