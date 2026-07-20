/**
 * Search & similarity helpers extracted from MemoryFabric (REFACTOR-5).
 *
 * Standalone functions for vector search, weighted retrieval, context
 * assembly, and duplicate detection. The MemoryFabric class delegates to
 * these to keep the main module focused on storage orchestration.
 */
import type { Pool } from 'pg';
import { toHalfvecLiteral } from './VectorQuantizer.js';
import type {
  MemoryNode,
  MemoryNodeCategory,
  GraphWalkOptions,
  GraphWalkResult,
  ContextAssemblyResult,
} from './MemoryFabric.js';

/** Context required by the search helpers. */
export interface SearchContext {
  pool: Pool;
  /** Whether the halfvec column is available for faster search. */
  isHalfvecAvailable: () => Promise<boolean>;
  /** Fire (touch) a neuron — update access count and last-accessed timestamp. */
  fireNeuron: (nodeId: string) => Promise<void>;
  /** Graph walk from a set of start nodes. */
  graphWalk: (options: GraphWalkOptions) => Promise<GraphWalkResult>;
}

export async function vectorSearch(
  ctx: SearchContext,
  embedding: number[],
  options: { limit?: number; category?: MemoryNodeCategory; agentId?: string; tag?: string; sessionId?: string | null } = {},
): Promise<MemoryNode[]> {
  const limit = options.limit ?? 10;
  const useHalfvec = await ctx.isHalfvecAvailable();
  const vectorLiteral = `[${embedding.join(',')}]`;
  const halfvecLiteral = toHalfvecLiteral(embedding);
  const embeddingColumn = useHalfvec ? 'embedding_halfvec' : 'embedding';
  const vectorCast = useHalfvec ? 'halfvec' : 'vector';
  const vectorValue = useHalfvec ? halfvecLiteral : vectorLiteral;

  let sessionFilter = '';
  if (options.sessionId === null) {
    sessionFilter = 'AND n.session_id IS NULL';
  } else if (options.sessionId) {
    sessionFilter = `AND n.session_id = '${options.sessionId}'`;
  }

  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt",
            n.${embeddingColumn} <=> $1::${vectorCast} AS distance
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.${embeddingColumn} IS NOT NULL
       AND n.status = 'active'
       ${options.category ? `AND n.category = '${options.category}'` : ''}
       ${options.tag ? `AND n.tag = '${options.tag}'` : ''}
       ${sessionFilter}
       ${options.agentId ? `AND (n.agent_id = '${options.agentId}' OR n.agent_id IS NULL)` : ''}
     ORDER BY n.${embeddingColumn} <=> $1::${vectorCast}
     LIMIT $2`,
    [vectorValue, limit],
  );
  for (const row of rows) {
    await ctx.fireNeuron(row.id);
  }
  return rows;
}

/**
 * Weight-prioritized vector retrieval (§4). Combines pgvector similarity with
 * the aggregate synaptic weight of each node's connected edges.
 */
export async function searchWeighted(
  ctx: SearchContext,
  embedding: number[],
  options: { limit?: number; category?: MemoryNodeCategory; agentId?: string } = {},
): Promise<Array<MemoryNode & { score: number; edgeWeight: number }>> {
  const limit = options.limit ?? 10;
  const useHalfvec = await ctx.isHalfvecAvailable();
  const vectorLiteral = `[${embedding.join(',')}]`;
  const halfvecLiteral = toHalfvecLiteral(embedding);
  const embeddingColumn = useHalfvec ? 'embedding_halfvec' : 'embedding';
  const vectorCast = useHalfvec ? 'halfvec' : 'vector';
  const vectorValue = useHalfvec ? halfvecLiteral : vectorLiteral;

  const { rows } = await ctx.pool.query<MemoryNode & { score: number; edgeWeight: number }>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt",
            1 - (n.${embeddingColumn} <=> $1::${vectorCast}) AS score,
            COALESCE((
              SELECT AVG(e.weight) FROM memory_edges e
              WHERE e.source_node_id = n.id OR e.target_node_id = n.id
            ), 0) AS "edgeWeight"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.${embeddingColumn} IS NOT NULL
       AND n.status = 'active'
       ${options.category ? `AND n.category = '${options.category}'` : ''}
       ${options.agentId ? `AND (n.agent_id = '${options.agentId}' OR n.agent_id IS NULL)` : ''}
     ORDER BY (1 - (n.${embeddingColumn} <=> $1::${vectorCast})) * 0.7 + COALESCE((
       SELECT AVG(e.weight) FROM memory_edges e
       WHERE e.source_node_id = n.id OR e.target_node_id = n.id
     ), 0) * 0.3 DESC
     LIMIT $2`,
    [vectorValue, limit],
  );
  for (const row of rows) {
    await ctx.fireNeuron(row.id);
  }
  return rows;
}

export async function assembleContext(
  ctx: SearchContext,
  sessionId: string,
  embedding: number[],
  options: { agentId?: string; episodicLimit?: number; semanticLimit?: number; graphDepth?: number } = {},
): Promise<ContextAssemblyResult> {
  const episodicLimit = options.episodicLimit ?? 5;
  const semanticLimit = options.semanticLimit ?? 10;
  const graphDepth = options.graphDepth ?? 3;

  // Tier 1: short-term episodic memory of the active session.
  const { rows: episodic } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.session_id = $1
       AND n.status = 'active'
     ORDER BY a.last_accessed_at DESC NULLS LAST, n.created_at DESC
     LIMIT $2`,
    [sessionId, episodicLimit],
  );

  // Tier 2: semantic vector match across the active agent's memory.
  const agentFilter = options.agentId ? `AND (n.agent_id = '${options.agentId}' OR n.agent_id IS NULL)` : '';
  const { rows: semantic } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt",
            n.embedding <=> $1::vector AS distance
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.embedding IS NOT NULL
       AND n.status = 'active'
       ${agentFilter}
     ORDER BY n.embedding <=> $1::vector
     LIMIT $2`,
    [`[${embedding.join(',')}]`, semanticLimit],
  );

  // Tier 3: graph walk from the semantic hits.
  const startNodeIds = semantic.map((n) => n.id);
  const graphResult = startNodeIds.length
    ? await ctx.graphWalk({ startNodeIds, maxDepth: graphDepth })
    : { nodeIds: [], edges: [] };

  const graphNodeIds = graphResult.nodeIds.filter((id) => !startNodeIds.includes(id));
  const graph: MemoryNode[] = [];
  if (graphNodeIds.length) {
    const { rows } = await ctx.pool.query<MemoryNode>(
      `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
              n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
              n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
              COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
       FROM memory_nodes n
       LEFT JOIN neuron_activity a ON a.node_id = n.id
       WHERE n.id = ANY($1::uuid[])
         AND n.status = 'active'`,
      [graphNodeIds],
    );
    graph.push(...rows);
  }

  return { episodic, semantic, graph };
}

export async function findDuplicate(
  ctx: SearchContext,
  embedding: number[],
  threshold = 0.95,
  category?: MemoryNodeCategory,
): Promise<MemoryNode | null> {
  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.embedding <=> $1::vector < $2
       ${category ? `AND n.category = '${category}'` : ''}
       AND n.status = 'active'
     ORDER BY n.embedding <=> $1::vector
     LIMIT 1`,
    [`[${embedding.join(',')}]`, 1 - threshold],
  );
  return rows[0] ?? null;
}
