/**
 * Persistence, cleanup & source management helpers extracted from MemoryFabric (REFACTOR-5).
 *
 * Standalone functions for re-embedding, source CRUD, session/benchmark wipes,
 * scorecard persistence, and reference-counted source pruning. The MemoryFabric
 * class delegates to these to keep the main module focused on storage orchestration.
 */
import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { toHalfvecLiteral } from './VectorQuantizer.js';
import { resolveEmbedTextForNode } from './retrieval/contextualize.js';
import type {
  MemoryNode,
  MemoryNodeCategory,
  MemorySource,
  ScorecardInput,
  Scorecard,
} from './MemoryFabric.js';

/** Context required by the persistence helpers. */
export interface PersistenceContext {
  pool: Pool;
}

// ── Re-embedding ─────────────────────────────────────────────────────

/**
 * Re-embed all active memory nodes in batches. Used when switching embedding models
 * or after dimension changes. Returns the number of nodes updated.
 */
export async function reEmbedAll(
  ctx: PersistenceContext,
  embedder: { embedBatch: (texts: string[]) => Promise<number[][]> },
  batchSize = 32,
): Promise<{ updated: number; failed: number }> {
  let offset = 0;
  let updated = 0;
  let failed = 0;
  while (true) {
    const { rows } = await ctx.pool.query<{
      id: string;
      content: string;
      label: string | null;
      heading_path: string[] | null;
      provenance: Record<string, unknown> | null;
    }>(
      `SELECT id, content, label, heading_path, provenance
         FROM memory_nodes
        WHERE status = 'active' AND embedding IS NOT NULL
        ORDER BY id
        LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );
    if (rows.length === 0) break;
    offset += rows.length;
    // Prefer ingest-time contextualized embedText so re-embed matches new uploads.
    const texts = rows.map((r) =>
      resolveEmbedTextForNode({
        content: r.content,
        label: r.label,
        headingPath: r.heading_path ?? undefined,
        provenance: r.provenance,
      }),
    );
    try {
      const embeddings = await embedder.embedBatch(texts);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const embedding = embeddings[i];
        if (!row || !embedding) continue;
        await ctx.pool.query(
          `UPDATE memory_nodes SET embedding = $1::vector, embedding_halfvec = $2::halfvec WHERE id = $3`,
          [`[${embedding.join(',')}]`, toHalfvecLiteral(embedding), row.id],
        );
        updated++;
      }
    } catch (e) {
      getLogger().warn('CORTEX_FABRIC_RE_EMBED', `Batch re-embed failed: ${e instanceof Error ? e.message : e}`);
      failed += rows.length;
    }
  }
  return { updated, failed };
}

// ── Source CRUD ──────────────────────────────────────────────────────

export async function createSource(
  ctx: PersistenceContext,
  name: string,
  kind: string,
  colorHex: string,
): Promise<MemorySource> {
  const { rows } = await ctx.pool.query<MemorySource>(
    `INSERT INTO memory_sources (name, kind, color_hex)
     VALUES ($1, $2, $3)
     RETURNING id, name, kind, color_hex AS "colorHex", created_at AS "createdAt"`,
    [name, kind, colorHex],
  );
  if (!rows[0]) throw new Error('Failed to create memory source');
  return rows[0];
}

export async function getSources(ctx: PersistenceContext): Promise<MemorySource[]> {
  const { rows } = await ctx.pool.query<MemorySource>(
    `SELECT id, name, kind, color_hex AS "colorHex", created_at AS "createdAt",
            file_path AS "filePath", file_size AS "fileSize", file_mime AS "fileMime"
     FROM memory_sources
     ORDER BY created_at DESC`,
  );
  return rows;
}

/** Update the file_path / file_size / file_mime on an existing source. */
export async function setSourceFilePath(
  ctx: PersistenceContext,
  sourceId: string,
  filePath: string,
  fileSize?: number,
  fileMime?: string,
): Promise<void> {
  await ctx.pool.query(
    `UPDATE memory_sources SET file_path = $1, file_size = $2, file_mime = $3 WHERE id = $4`,
    [filePath, fileSize ?? null, fileMime ?? null, sourceId],
  );
}

/** Get all nodes belonging to a specific source, with pagination. */
export async function getNodesBySource(
  ctx: PersistenceContext,
  sourceId: string,
  options: { limit?: number; offset?: number; category?: MemoryNodeCategory } = {},
): Promise<{ nodes: MemoryNode[]; total: number }> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const categoryFilter = options.category ? `AND category = '${options.category}'` : '';
  const { rows: nodes } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.unit_type AS "unitType", n.provenance,
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.source_id = $1 AND n.status = 'active' ${categoryFilter}
     ORDER BY n.created_at ASC
     LIMIT $2 OFFSET $3`,
    [sourceId, limit, offset],
  );
  const { rows: countRows } = await ctx.pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM memory_nodes WHERE source_id = $1 AND status = 'active' ${categoryFilter}`,
    [sourceId],
  );
  return { nodes, total: countRows[0]?.count ?? 0 };
}

// ── Wipe / cleanup ───────────────────────────────────────────────────

/**
 * Remove memory fabric nodes (and connected edges) for a session scope.
 * sessionId null = super-session global bucket (session_id IS NULL).
 */
export async function wipeMemoryForSessionScope(
  ctx: PersistenceContext,
  sessionId: string | null,
): Promise<{ deletedNodes: number; deletedEdges: number }> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const sessionClause = sessionId === null ? 'session_id IS NULL' : 'session_id = $1';
    const params = sessionId === null ? [] : [sessionId];
    const { rowCount: deletedEdges } = await client.query(
      `DELETE FROM memory_edges
       WHERE source_node_id IN (SELECT id FROM memory_nodes WHERE ${sessionClause})
          OR target_node_id IN (SELECT id FROM memory_nodes WHERE ${sessionClause})`,
      params,
    );
    await client.query(
      `DELETE FROM neuron_activity
       WHERE node_id IN (SELECT id FROM memory_nodes WHERE ${sessionClause})`,
      params,
    );
    const { rowCount: deletedNodes } = await client.query(
      `DELETE FROM memory_nodes WHERE ${sessionClause}`,
      params,
    );
    await client.query('COMMIT');
    return { deletedNodes: deletedNodes ?? 0, deletedEdges: deletedEdges ?? 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function wipeBenchmark(
  ctx: PersistenceContext,
): Promise<{ deletedNodes: number; deletedEdges: number }> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: deletedEdges } = await client.query(
      `DELETE FROM memory_edges
       WHERE source_node_id IN (SELECT id FROM memory_nodes WHERE is_benchmark = TRUE)
          OR target_node_id IN (SELECT id FROM memory_nodes WHERE is_benchmark = TRUE)`,
    );
    const { rowCount: deletedNodes } = await client.query(
      `DELETE FROM memory_nodes WHERE is_benchmark = TRUE`,
    );
    await client.query('COMMIT');
    return { deletedNodes: deletedNodes ?? 0, deletedEdges: deletedEdges ?? 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Scorecard persistence ────────────────────────────────────────────

export async function saveScorecard(
  ctx: PersistenceContext,
  scorecard: ScorecardInput,
): Promise<Scorecard> {
  const { rows } = await ctx.pool.query<Scorecard>(
    `INSERT INTO benchmark_scorecards
      (run_id, model, provider, started_at, finished_at, total_score, max_score, rag_triad, test_results, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (run_id) DO UPDATE SET
       model = EXCLUDED.model,
       provider = EXCLUDED.provider,
       started_at = EXCLUDED.started_at,
       finished_at = EXCLUDED.finished_at,
       total_score = EXCLUDED.total_score,
       max_score = EXCLUDED.max_score,
       rag_triad = EXCLUDED.rag_triad,
       test_results = EXCLUDED.test_results,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    [
      scorecard.runId,
      scorecard.model,
      scorecard.provider,
      scorecard.startedAt,
      scorecard.finishedAt,
      scorecard.totalScore,
      scorecard.maxScore,
      scorecard.ragTriad ? JSON.stringify(scorecard.ragTriad) : null,
      JSON.stringify(scorecard.testResults),
      scorecard.metadata ? JSON.stringify(scorecard.metadata) : null,
    ],
  );
  if (!rows[0]) throw new Error('Failed to save scorecard');
  return rows[0];
}

export async function getScorecards(
  ctx: PersistenceContext,
  limit = 50,
): Promise<Scorecard[]> {
  const { rows } = await ctx.pool.query<Scorecard>(
    `SELECT * FROM benchmark_scorecards ORDER BY finished_at DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows;
}

// ── Reference-counted source pruning ─────────────────────────────────

/**
 * Reference-counting prune: when a source is deleted, remove nodes that are
 * exclusively referenced by that source, while preserving shared nodes and
 * removing only the edges to the deleted source.
 */
export async function pruneSource(
  ctx: PersistenceContext,
  sourceId: string,
): Promise<{ deletedNodes: number; deletedEdges: number; archivedSource: boolean }> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: exclusiveNodes } = await client.query<{ id: string }>(
      `SELECT n.id
       FROM memory_nodes n
       WHERE n.source_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM memory_edges e
           WHERE e.target_node_id = n.id
             AND e.relationship_type = 'CONTAINS'
             AND e.source_node_id IN (
               SELECT id FROM memory_nodes WHERE source_id != $1
             )
         )`,
      [sourceId],
    );

    let deletedNodes = 0;
    for (const row of exclusiveNodes) {
      await client.query(`DELETE FROM memory_nodes WHERE id = $1`, [row.id]);
      deletedNodes++;
    }

    const { rowCount: deletedEdges } = await client.query(
      `DELETE FROM memory_edges
       WHERE source_node_id IN (SELECT id FROM memory_nodes WHERE source_id = $1)
          OR target_node_id IN (SELECT id FROM memory_nodes WHERE source_id = $1)`,
      [sourceId],
    );

    await client.query(`UPDATE memory_sources SET kind = 'archived' WHERE id = $1`, [sourceId]);

    await client.query('COMMIT');
    return { deletedNodes, deletedEdges: deletedEdges ?? 0, archivedSource: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
