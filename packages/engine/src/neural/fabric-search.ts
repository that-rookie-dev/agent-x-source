/**
 * Search & similarity helpers extracted from MemoryFabric (REFACTOR-5).
 *
 * Standalone functions for vector search, weighted retrieval, context
 * assembly, hybrid lexical search, and duplicate detection.
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
import { getRetrievalSettings } from './retrieval/settings.js';
import { mergeRrf } from './retrieval/hybrid.js';

/** Context required by the search helpers. */
export interface SearchContext {
  pool: Pool;
  /** Whether the halfvec column is available for faster search. */
  isHalfvecAvailable: () => Promise<boolean>;
  /** Fire (touch) a neuron — update access count and last-accessed timestamp. */
  fireNeuron: (nodeId: string) => Promise<void>;
  /** Batch-touch neurons (preferred on hot paths). */
  fireNeurons?: (nodeIds: string[]) => Promise<void>;
  /** Graph walk from a set of start nodes. */
  graphWalk: (options: GraphWalkOptions) => Promise<GraphWalkResult>;
}

let contentTsvAvailable: boolean | null = null;

async function hasContentTsv(pool: Pool): Promise<boolean> {
  if (contentTsvAvailable != null) return contentTsvAvailable;
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'memory_nodes' AND column_name = 'content_tsv'
       ) AS exists`,
    );
    contentTsvAvailable = !!rows[0]?.exists;
  } catch {
    contentTsvAvailable = false;
  }
  return contentTsvAvailable;
}

/** Reset FTS availability cache (tests / after migration). */
export function resetContentTsvCache(): void {
  contentTsvAvailable = null;
}

async function touchNeurons(ctx: SearchContext, ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (ctx.fireNeurons) {
    await ctx.fireNeurons(ids);
    return;
  }
  await Promise.all(ids.map((id) => ctx.fireNeuron(id)));
}

function sessionFilterSql(sessionId: string | null | undefined): string {
  if (sessionId === null) return 'AND n.session_id IS NULL';
  if (sessionId) return `AND n.session_id = '${sessionId.replace(/'/g, "''")}'`;
  return '';
}

/** Gate-friendly confidence for a lexical (FTS) hit — not raw ts_rank. */
const LEXICAL_HIT_SCORE = 0.55;

export type FabricSearchOptions = {
  limit?: number;
  category?: MemoryNodeCategory;
  agentId?: string;
  tag?: string;
  sessionId?: string | null;
  /** Restrict to a single knowledge / memory source (e.g. @kb pin). */
  sourceId?: string;
  touch?: boolean;
};

const NODE_SELECT = `n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            n.heading_path AS "headingPath", n.unit_type AS "unitType", n.provenance AS "provenance",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"`;

export async function vectorSearch(
  ctx: SearchContext,
  embedding: number[],
  options: FabricSearchOptions = {},
): Promise<MemoryNode[]> {
  const limit = options.limit ?? 10;
  const useHalfvec = await ctx.isHalfvecAvailable();
  const vectorLiteral = `[${embedding.join(',')}]`;
  const halfvecLiteral = toHalfvecLiteral(embedding);
  const embeddingColumn = useHalfvec ? 'embedding_halfvec' : 'embedding';
  const vectorCast = useHalfvec ? 'halfvec' : 'vector';
  const vectorValue = useHalfvec ? halfvecLiteral : vectorLiteral;
  const sessionFilter = sessionFilterSql(options.sessionId);
  const params: unknown[] = [vectorValue, limit];
  let sourceClause = '';
  if (options.sourceId) {
    params.push(options.sourceId);
    sourceClause = `AND n.source_id = $${params.length}`;
  }

  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT ${NODE_SELECT},
            n.${embeddingColumn} <=> $1::${vectorCast} AS distance
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.${embeddingColumn} IS NOT NULL
       AND n.status = 'active'
       ${options.category ? `AND n.category = '${options.category}'` : ''}
       ${options.tag ? `AND n.tag = '${options.tag}'` : ''}
       ${sessionFilter}
       ${sourceClause}
       ${options.agentId ? `AND (n.agent_id = '${options.agentId}' OR n.agent_id IS NULL)` : ''}
     ORDER BY n.${embeddingColumn} <=> $1::${vectorCast}
     LIMIT $2`,
    params,
  );
  if (options.touch !== false) {
    await touchNeurons(ctx, rows.map((r) => r.id));
  }
  return rows;
}

/**
 * Full-text lexical search over content_tsv (GIN). Returns empty when column absent.
 */
export async function lexicalSearch(
  ctx: SearchContext,
  query: string,
  options: FabricSearchOptions = {},
): Promise<MemoryNode[]> {
  const q = query.trim();
  if (!q) return [];
  if (!(await hasContentTsv(ctx.pool))) return [];

  const limit = options.limit ?? getRetrievalSettings().lexicalOverFetch;
  const sessionFilter = sessionFilterSql(options.sessionId);
  const params: unknown[] = [q, limit, LEXICAL_HIT_SCORE];
  let sourceClause = '';
  if (options.sourceId) {
    params.push(options.sourceId);
    sourceClause = `AND n.source_id = $${params.length}`;
  }

  try {
    // AND queries (plain/websearch) often miss when terms span chunks; fall back to OR.
    // Never expose raw ts_rank as cosine `score` — that failed minScoreKb after RRF.
    let rows = await runLexicalQuery(ctx, params, sessionFilter, sourceClause, options, 'plain');
    if (!rows.length) {
      const orQuery = buildOrTsQuery(q);
      if (orQuery) {
        const orParams = [orQuery, limit, LEXICAL_HIT_SCORE, ...(options.sourceId ? [options.sourceId] : [])];
        rows = await runLexicalQuery(ctx, orParams, sessionFilter, sourceClause, options, 'or');
      }
    }
    if (options.touch !== false) {
      await touchNeurons(ctx, rows.map((r) => r.id));
    }
    return rows;
  } catch {
    // Column/index race during migration — degrade to empty lexical set.
    contentTsvAvailable = false;
    return [];
  }
}

/** Build `to_tsquery` OR expression from significant tokens. */
function buildOrTsQuery(query: string): string {
  const stop = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'when', 'where',
    'how', 'are', 'was', 'were', 'have', 'has', 'had', 'into', 'about', 'your',
    'our', 'any', 'all', 'can', 'may', 'not', 'but', 'use', 'using',
  ]);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !stop.has(t) && !/^\d{1,2}$/.test(t));
  const uniq = [...new Set(terms)].slice(0, 12);
  if (uniq.length === 0) return '';
  return uniq.map((t) => t.replace(/'/g, "''")).join(' | ');
}

async function runLexicalQuery(
  ctx: SearchContext,
  params: unknown[],
  sessionFilter: string,
  sourceClause: string,
  options: FabricSearchOptions,
  mode: 'plain' | 'or',
): Promise<Array<MemoryNode & { score: number }>> {
  const tsQuery = mode === 'or'
    ? `to_tsquery('english', $1)`
    : `plainto_tsquery('english', $1)`;
  try {
    const { rows } = await ctx.pool.query<MemoryNode & { score: number }>(
      `SELECT ${NODE_SELECT},
              $3::float8 AS score,
              NULL::float8 AS distance,
              ts_rank_cd(n.content_tsv, ${tsQuery}) AS rank
       FROM memory_nodes n
       LEFT JOIN neuron_activity a ON a.node_id = n.id
       WHERE n.status = 'active'
         AND n.content_tsv @@ ${tsQuery}
         ${options.category ? `AND n.category = '${options.category}'` : ''}
         ${options.tag ? `AND n.tag = '${options.tag}'` : ''}
         ${sessionFilter}
         ${sourceClause}
         ${options.agentId ? `AND (n.agent_id = '${options.agentId}' OR n.agent_id IS NULL)` : ''}
       ORDER BY rank DESC
       LIMIT $2`,
      params,
    );
    return rows;
  } catch {
    return [];
  }
}

/**
 * Hybrid vector ∪ lexical via RRF. Falls back to vector-only when FTS unavailable or disabled.
 */
export async function hybridSearch(
  ctx: SearchContext,
  embedding: number[],
  query: string,
  options: FabricSearchOptions & {
    vectorLimit?: number;
    lexicalLimit?: number;
  } = {},
): Promise<MemoryNode[]> {
  const settings = getRetrievalSettings();
  const limit = options.limit ?? 10;
  const vectorLimit = options.vectorLimit ?? Math.max(limit, settings.vectorOverFetch);
  const lexicalLimit = options.lexicalLimit ?? Math.max(limit, settings.lexicalOverFetch);

  const vectorHits = await vectorSearch(ctx, embedding, {
    ...options,
    limit: vectorLimit,
    touch: false,
  });

  if (!settings.hybridEnabled) {
    await touchNeurons(ctx, vectorHits.slice(0, limit).map((r) => r.id));
    return vectorHits.slice(0, limit);
  }

  const lexicalHits = await lexicalSearch(ctx, query, {
    ...options,
    limit: lexicalLimit,
    touch: false,
  });

  if (!lexicalHits.length) {
    await touchNeurons(ctx, vectorHits.slice(0, limit).map((r) => r.id));
    return vectorHits.slice(0, limit);
  }

  const merged = mergeRrf(
    vectorHits.map((n) => ({ ...n, id: n.id })),
    lexicalHits.map((n) => ({ ...n, id: n.id, score: (n as MemoryNode & { score?: number }).score })),
    { limit },
  );

  await touchNeurons(ctx, merged.map((r) => r.id));
  return merged;
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
    `SELECT ${NODE_SELECT},
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
  await touchNeurons(ctx, rows.map((r) => r.id));
  return rows;
}

export async function assembleContext(
  ctx: SearchContext,
  sessionId: string,
  embedding: number[],
  options: { agentId?: string; episodicLimit?: number; semanticLimit?: number; graphDepth?: number } = {},
): Promise<ContextAssemblyResult> {
  const settings = getRetrievalSettings();
  const episodicLimit = options.episodicLimit ?? settings.episodicLimit;
  const semanticLimit = options.semanticLimit ?? 10;
  const graphDepth = options.graphDepth ?? settings.graphExpandDepth;

  // Tier 1: short-term episodic memory of the active session.
  const { rows: episodic } = await ctx.pool.query<MemoryNode>(
    `SELECT ${NODE_SELECT}
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
    `SELECT ${NODE_SELECT},
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

  // Tier 3: controlled graph walk (depth default 1; order+semantic edge types).
  const startNodeIds = semantic.slice(0, settings.graphExpandOnlyOnTopHits).map((n) => n.id);
  const graphResult = startNodeIds.length && graphDepth > 0
    ? await ctx.graphWalk({
        startNodeIds,
        maxDepth: graphDepth,
        maxFanOut: 2,
        minWeight: 0.2,
        relationshipTypes: ['FOLLOWS', 'PRECEDES', 'NEXT_STEP', 'RELATED_TO', 'SYNONYM'],
      })
    : { nodeIds: [], edges: [] };

  const graphNodeIds = graphResult.nodeIds.filter((id) => !startNodeIds.includes(id));
  const graph: MemoryNode[] = [];
  if (graphNodeIds.length) {
    const { rows } = await ctx.pool.query<MemoryNode>(
      `SELECT ${NODE_SELECT}
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
    `SELECT ${NODE_SELECT}
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
