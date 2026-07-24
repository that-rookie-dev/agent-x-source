/**
 * Node CRUD helpers extracted from MemoryFabric (REFACTOR-6).
 *
 * Standalone functions for creating, reading, and binding memory nodes/edges.
 * The MemoryFabric class delegates to these to keep the main module focused
 * on storage orchestration.
 */
import type { Pool } from 'pg';
import type { PiiRedactor } from './PiiRedactor.js';
import { toHalfvecLiteral } from './VectorQuantizer.js';
import type {
  MemoryNode,
  MemoryNodeInput,
  MemoryNodeCategory,
  MemoryEdge,
  MemoryEdgeInput,
} from './MemoryFabric.js';

/** Context required by the node CRUD helpers. */
export interface NodeCrudContext {
  pool: Pool;
  piiRedactor: PiiRedactor;
  /** Fire (touch) a neuron — update access count and last-accessed timestamp. */
  fireNeuron: (nodeId: string) => Promise<void>;
}

/** Build a PostgreSQL INT4RANGE literal string '[start,end]' for inclusive bounds. */
function int4rangeLiteral(start: number, end: number): string {
  return `[${Math.floor(start)},${Math.floor(end)}]`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function deterministicLayoutSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function createNode(ctx: NodeCrudContext, input: MemoryNodeInput): Promise<MemoryNode> {
  const redacted = await ctx.piiRedactor.redact(input.content);
  const content = redacted.redacted;

  const embedding = input.embedding
    ? `[${input.embedding.join(',')}]`
    : null;

  const nodeId = input.id ?? crypto.randomUUID();
  const seed = deterministicLayoutSeed(nodeId);
  const x = input.x ?? ((seed % 1000) - 500) + (Math.sin(seed) * 100);
  const y = input.y ?? ((seed % 1000) - 500) + (Math.cos(seed) * 100);
  const layoutEpoch = input.layoutEpoch ?? 0;

  const tag = input.tag ?? null;
  const isBenchmark = input.isBenchmark ?? false;

  const halfvec = input.embedding && input.embedding.length > 0 ? toHalfvecLiteral(input.embedding) : null;
  const headingPath = input.headingPath && input.headingPath.length > 0 ? input.headingPath : null;
  const charSpan = input.charSpan ? int4rangeLiteral(input.charSpan[0], input.charSpan[1]) : null;
  const unitType = input.unitType ?? null;
  const provenance = input.provenance ? JSON.stringify(input.provenance) : null;
  // source_id is a UUID FK to memory_sources — external provenance strings
  // (e.g. document names) are not valid values for that column.
  const sourceId = input.sourceId && isUuid(input.sourceId) ? input.sourceId : null;
  const { rows } = await ctx.pool.query<MemoryNode>(
    `INSERT INTO memory_nodes
      (id, label, category, content, embedding, embedding_halfvec, status, source_id, session_id, agent_id, confidence, x, y, layout_epoch, tag, is_benchmark,
       heading_path, char_span, unit_type, provenance)
     VALUES ($1, $2, $3, $4, $5::vector, $6::halfvec, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18::int4range, $19, $20::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET content = EXCLUDED.content,
           confidence = GREATEST(memory_nodes.confidence, EXCLUDED.confidence),
           updated_at = NOW()
     RETURNING id, label, category, content, status, x, y, layout_epoch AS "layoutEpoch", tag, is_benchmark AS "isBenchmark", source_id AS "sourceId", session_id AS "sessionId",
       agent_id AS "agentId", confidence, created_at AS "createdAt", updated_at AS "updatedAt",
       heading_path AS "headingPath", char_span AS "charSpan", unit_type AS "unitType", provenance AS "provenance"`,
    [
      nodeId,
      input.label,
      input.category,
      content,
      embedding,
      halfvec,
      input.status ?? 'active',
      sourceId,
      input.sessionId ?? null,
      input.agentId ?? null,
      input.confidence ?? 0.8,
      x,
      y,
      layoutEpoch,
      tag,
      isBenchmark,
      headingPath,
      charSpan,
      unitType,
      provenance,
    ],
  );

  if (!rows[0]) throw new Error('Failed to create memory node');
  await ctx.fireNeuron(nodeId);
  const node = await getNode(ctx, nodeId);
  if (!node) throw new Error('Failed to retrieve newly created memory node');
  return node;
}

export async function bindEdge(ctx: NodeCrudContext, input: MemoryEdgeInput): Promise<MemoryEdge> {
  const { rows } = await ctx.pool.query<MemoryEdge>(
    `INSERT INTO memory_edges
      (source_node_id, target_node_id, relationship_type, weight, extraction_method)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_node_id, target_node_id, relationship_type)
     DO UPDATE SET weight = GREATEST(memory_edges.weight, EXCLUDED.weight),
                   extraction_method = COALESCE(EXCLUDED.extraction_method, memory_edges.extraction_method),
                   updated_at = NOW()
     RETURNING id, source_node_id AS "sourceNodeId", target_node_id AS "targetNodeId",
       relationship_type AS "relationshipType", weight, created_at AS "createdAt", updated_at AS "updatedAt",
       extraction_method AS "extractionMethod"`,
    [
      input.sourceNodeId,
      input.targetNodeId,
      input.relationshipType,
      input.weight ?? 0.5,
      input.extractionMethod ?? null,
    ],
  );
  if (!rows[0]) throw new Error('Failed to bind memory edge');
  return rows[0];
}

export async function fireNeuron(ctx: NodeCrudContext, nodeId: string): Promise<void> {
  await fireNeurons(ctx, [nodeId]);
}

/** Batch-touch neurons — preferred on retrieval hot paths. */
export async function fireNeurons(ctx: NodeCrudContext, nodeIds: string[]): Promise<void> {
  const ids = [...new Set(nodeIds.filter(Boolean))];
  if (!ids.length) return;
  await ctx.pool.query(
    `INSERT INTO neuron_activity (node_id, last_accessed_at, access_count)
     SELECT unnest($1::uuid[]), NOW(), 1
     ON CONFLICT (node_id)
     DO UPDATE SET last_accessed_at = NOW(), access_count = neuron_activity.access_count + 1`,
    [ids],
  );
}

/**
 * Find nodes by session ID and category. Used to check if a session hub
 * already exists before creating a duplicate (survives server restarts).
 */
export async function findNodesBySessionAndCategory(
  ctx: NodeCrudContext,
  sessionId: string,
  category: MemoryNodeCategory,
): Promise<MemoryNode[]> {
  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            n.heading_path AS "headingPath", n.char_span AS "charSpan", n.unit_type AS "unitType", n.provenance AS "provenance",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.session_id = $1 AND n.category = $2
     ORDER BY n.created_at ASC
     LIMIT 5`,
    [sessionId, category],
  );
  return rows;
}

export async function getNode(ctx: NodeCrudContext, id: string): Promise<MemoryNode | null> {
  const { rows } = await ctx.pool.query<MemoryNode>(
    `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
            n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
            n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            n.heading_path AS "headingPath", n.char_span AS "charSpan", n.unit_type AS "unitType", n.provenance AS "provenance",
            COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
     FROM memory_nodes n
     LEFT JOIN neuron_activity a ON a.node_id = n.id
     WHERE n.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const node = rows[0];
  if (!node) return null;
  await ctx.fireNeuron(id);
  return node;
}

/** Skip duplicate chat-turn embeddings (same session + user turn label). */
export async function hasChatMemoryTurn(
  ctx: NodeCrudContext,
  sourceSessionId: string,
  label: string,
): Promise<boolean> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM memory_nodes
     WHERE tag = 'chat_memory'
       AND provenance->>'sourceSessionId' = $1
       AND label = $2
     LIMIT 1`,
    [sourceSessionId, label],
  );
  return rows.length > 0;
}

/** Create the system-init confirmation node if it does not already exist. */
export async function seedSystemInitNode(ctx: NodeCrudContext): Promise<{ created: boolean; nodeId?: string }> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM memory_nodes WHERE category = 'system' AND tag = 'system_init' LIMIT 1`,
  );
  if (rows.length > 0 && rows[0]) {
    return { created: false, nodeId: rows[0].id };
  }
  const node = await createNode(ctx, {
    label: 'System Initialized',
    category: 'system',
    content: 'Agent-X neural fabric initialized. PostgreSQL storage provisioned and schema migrated.',
    tag: 'system_init',
    confidence: 1,
  });
  return { created: true, nodeId: node.id };
}
