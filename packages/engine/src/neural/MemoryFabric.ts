/**
 * Unified Neural Brain / Memory Fabric
 *
 * A single node/edge store for all Agent-X memory: knowledge, episodic sessions,
 * tools, personas, and web data. Uses PostgreSQL + pgvector for semantic search
 * and recursive CTEs for graph traversal (AGE optional).
 */
import { Pool } from 'pg';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { getLogger } from '@agentx/shared';
import { MemoryMigrationRunner } from './MemoryMigrationRunner.js';
import { PiiRedactor } from './PiiRedactor.js';
import { SecureVault } from './SecureVault.js';
import { toHalfvecLiteral } from './VectorQuantizer.js';
export type MemoryNodeCategory =
  | 'persona'
  | 'tool'
  | 'episodic'
  | 'semantic'
  | 'source_doc'
  | 'system';

export type MemoryEdgeType =
  | 'CONTAINS'
  | 'REFERENCES'
  | 'NEXT_STEP'
  | 'REQUIRES'
  | 'RELATED_TO'
  | 'GENERATED_OUTPUT'
  | 'USING_TOOL'
  | 'SHARED_INSIGHT'
  | 'CAUSES'
  | 'IS_A'
  | 'PART_OF'
  | 'HAS_PROPERTY'
  | 'LOCATED_IN'
  | 'OCCURRED_IN'
  | 'MENTIONS'
  | 'LEADS_TO'
  | 'INFLUENCES'
  | 'CONTRIBUTES_TO'
  | 'RESULTS_IN'
  | 'DESCRIBES'
  | 'EXAMPLES'
  | 'OPPOSES'
  | 'SYNONYM'
  | 'PRECEDES'
  | 'FOLLOWS'
  | 'PARENT_OF'
  | 'DEPENDS_ON'
  | 'MODIFIES'
  | 'RESONATES_WITH';

export interface MemoryNodeInput {
  id?: string;
  label: string;
  category: MemoryNodeCategory;
  content: string;
  embedding?: number[];
  sourceId?: string;
  sessionId?: string;
  agentId?: string;
  confidence?: number;
  status?: 'active' | 'failed' | 'decayed' | 'archived';
  x?: number | null;
  y?: number | null;
  layoutEpoch?: number;
  tag?: string;
  isBenchmark?: boolean;
  /** Provenance: markdown heading path to the source section (e.g. ["## Auth", "### JWT"]). */
  headingPath?: string[];
  /** Provenance: character span [start, end] in the source text. */
  charSpan?: [number, number];
  /** Provenance: TextUnit type this node was extracted from (proposition, section, raw_fallback, hub, ...). */
  unitType?: string;
  /** Free-form provenance metadata (turn index, content type, extractor version, ...). */
  provenance?: Record<string, unknown>;
}

export interface MemoryNode extends Omit<MemoryNodeInput, 'charSpan' | 'provenance'> {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
  lastAccessedAt: Date | null;
  /**
   * Provenance: character span in the source text. On write this is `[start, end]`;
   * on read from PostgreSQL the INT4RANGE column comes back as a string like `"[0,10]"`.
   * Callers reading from the DB should parse the string if a numeric tuple is needed.
   */
  charSpan?: string | [number, number];
  /** Provenance: free-form metadata from the DB (parsed JSONB object). */
  provenance?: Record<string, unknown>;
}

export interface MemoryEdgeInput {
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: MemoryEdgeType;
  weight?: number;
  /** How the edge was derived: EXTRACTED (directly stated in text) or INFERRED (LLM-inferred). */
  extractionMethod?: 'EXTRACTED' | 'INFERRED';
}

export interface MemoryEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: MemoryEdgeType;
  weight: number;
  createdAt: Date;
  updatedAt: Date;
  /** How the edge was derived: EXTRACTED (directly stated in text) or INFERRED (LLM-inferred). */
  extractionMethod?: 'EXTRACTED' | 'INFERRED';
}

export interface MemorySource {
  id: string;
  name: string;
  kind: string;
  colorHex: string;
  createdAt: Date;
  /** Path to the original uploaded file (if the source was created from a file upload). */
  filePath?: string | null;
  /** Size of the original file in bytes. */
  fileSize?: number | null;
  /** MIME type of the original file. */
  fileMime?: string | null;
}

export interface GraphWalkOptions {
  startNodeIds: string[];
  maxDepth?: number;
  maxFanOut?: number;
  minWeight?: number;
  relationshipTypes?: MemoryEdgeType[];
}

export interface GraphWalkResult {
  nodeIds: string[];
  edges: Array<{ sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number }>;
}

export interface ContextAssemblyResult {
  episodic: MemoryNode[];
  semantic: MemoryNode[];
  graph: MemoryNode[];
}

// Embedding dimension — 1024 to match BGE-M3 (the primary model).
// MiniLM (384-dim) and n-gram fallback vectors are zero-padded to 1024.
export const DEFAULT_EMBEDDING_DIMENSION = 1024;

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

// ── Module-level singleton for tool access ──────────────────────────
let _fabricInstance: MemoryFabric | null = null;

/** Set the global MemoryFabric singleton (called once at engine startup). */
export function setMemoryFabricInstance(fabric: MemoryFabric | null): void {
  _fabricInstance = fabric;
}

/** Get the global MemoryFabric singleton (used by tools like memory_fabric_search). */
export function getMemoryFabricInstance(): MemoryFabric | null {
  return _fabricInstance;
}

export class MemoryFabric {
  private piiRedactor: PiiRedactor;
  private vault?: SecureVault;
  private halfvecAvailable: boolean | null = null;

  constructor(private pool: Pool) {
    this.piiRedactor = new PiiRedactor();
  }

  setPiiRedactor(redactor: PiiRedactor): void {
    this.piiRedactor = redactor;
  }

  setVault(vault: SecureVault): void {
    this.vault = vault;
    this.piiRedactor = new PiiRedactor({ vault });
  }

  async isHalfvecAvailable(): Promise<boolean> {
    if (this.halfvecAvailable !== null) return this.halfvecAvailable;
    try {
      await this.pool.query(`SELECT '[0.5]'::halfvec`);
      const { rows } = await this.pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memory_nodes' AND column_name = 'embedding_halfvec') AS available`
      );
      this.halfvecAvailable = rows[0]?.available === true;
    } catch {
      this.halfvecAvailable = false;
    }
    return this.halfvecAvailable;
  }

  async vaultRestore(token: string): Promise<string | null> {
    return this.vault?.retrieve(token) ?? null;
  }

  async vaultPurge(kind?: string): Promise<number> {
    return this.vault?.purge(kind) ?? 0;
  }

  async vaultList(options?: { kind?: string; limit?: number; offset?: number }): Promise<Pick<import('./SecureVault.js').VaultEntry, 'token' | 'kind' | 'createdAt' | 'updatedAt'>[]> {
    return this.vault?.list(options) ?? [];
  }

  async migrate(): Promise<{ applied: number; currentVersion: number; ageAvailable: boolean }> {
    const runner = new MemoryMigrationRunner(this.pool);
    const { applied, currentVersion } = await runner.ensureSchema();
    const { available: ageAvailable } = await runner.detectAge();
    return { applied, currentVersion, ageAvailable };
  }

  /**
   * Comprehensive self-healing pass:
   * - re-run versioned migrations,
   * - ensure required extensions (vector, age) exist,
   * - ensure AGE graph exists (with relational fallback on failure),
   * - verify every required table and recreate missing indexes.
   * Safe to call on every startup and periodic health pass.
   */
  async heal(onProgress?: (line: string) => void): Promise<{ schemaRepaired: boolean; ageAvailable: boolean; ageError?: string }> {
    const runner = new MemoryMigrationRunner(this.pool);
    const { applied, currentVersion } = await runner.ensureSchema();
    if (onProgress) {
      if (applied === 0) {
        onProgress(`Neural memory fabric verified (schema v${currentVersion}, 0 new migrations).`);
      } else {
        onProgress(`Applied ${applied} neural memory migration(s) — now at v${currentVersion}.`);
      }
    }
    let { available: ageAvailable, error: ageError } = await runner.detectAge();

    // If AGE is available as an extension but not installed yet (e.g. the database
    // was migrated before AGE was built), create it now. This makes the migration
    // idempotent with respect to AGE availability.
    if (!ageAvailable && !ageError) {
      try {
        const { rows } = await this.pool.query<{ available: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'age') AS available`
        );
        if (rows[0]?.available) {
          await this.pool.query('CREATE EXTENSION IF NOT EXISTS age');
          const { available } = await runner.detectAge();
          ageAvailable = available;
        }
      } catch (installErr) {
        ageError = installErr instanceof Error ? installErr.message : String(installErr);
        getLogger().warn('MEMORY_FABRIC_HEAL', `AGE extension install failed: ${ageError}`);
      }
    }

    if (onProgress) {
      if (ageAvailable) {
        onProgress('Apache AGE graph extension found.');
      } else if (ageError) {
        onProgress(`Apache AGE not available (optional): ${ageError}`);
      } else {
        onProgress('Apache AGE not installed (optional — SQL graph fallback active).');
      }
    }

    let graphRepaired = false;
    if (ageAvailable) {
      try {
        await this.pool.query('SET search_path = ag_catalog, public');
        await this.pool.query(`
          DO $$
          BEGIN
            PERFORM * FROM ag_catalog.ag_graph WHERE name = 'memory_graph';
            IF NOT FOUND THEN
              PERFORM ag_catalog.create_graph('memory_graph');
            END IF;
          END$$;
        `);
        await this.pool.query('SET search_path = public');
        graphRepaired = true;
        onProgress?.('AGE memory graph verified.');
      } catch (graphErr) {
        getLogger().warn('MEMORY_FABRIC_HEAL', `AGE graph repair failed: ${graphErr instanceof Error ? graphErr.message : graphErr}`);
        await this.pool.query('SET search_path = public').catch(() => {});
      }
    }
    const missingIndexes = await this.verifyIndexes();
    if (missingIndexes.length > 0) {
      getLogger().warn('MEMORY_FABRIC_HEAL', `Rebuilding missing indexes: ${missingIndexes.join(', ')}`);
      onProgress?.(`Rebuilding ${missingIndexes.length} missing neural memory index(es)…`);
    }
    const schemaRepaired = applied > 0 || graphRepaired || missingIndexes.length > 0;
    return { schemaRepaired, ageAvailable, ageError };
  }

  private async verifyIndexes(): Promise<string[]> {
    const required = [
      'idx_memory_nodes_category',
      'idx_memory_nodes_status',
      'idx_memory_nodes_session_id',
      'idx_memory_nodes_source_id',
      'idx_memory_nodes_embedding',
      'idx_memory_nodes_layout_epoch',
      'idx_memory_nodes_spatial',
      'idx_memory_nodes_tag',
      'idx_memory_nodes_is_benchmark',
      'idx_memory_edges_source',
      'idx_memory_edges_target',
      'idx_memory_edges_type',
      'idx_web_staging_domain',
      'idx_web_staging_status',
      'idx_benchmark_scorecards_model',
      'idx_benchmark_scorecards_finished_at',
    ];
    const { rows } = await this.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [required],
    );
    const existing = new Set(rows.map((r) => r.indexname));
    const missing = required.filter((n) => !existing.has(n));
    if (missing.length > 0) {
      const runner = new MemoryMigrationRunner(this.pool);
      await runner.ensureSchema();
    }
    return missing;
  }

  /** Strengthen synaptic edges attached to a node when its memory is successfully used. */
  async reinforce(nodeId: string): Promise<void> {
    const { SynapticPlasticity } = await import('./SynapticPlasticity.js');
    const plasticity = new SynapticPlasticity(this);
    await plasticity.reinforce(nodeId);
  }

  /**
   * Re-embed all active memory nodes in batches. Used when switching embedding models
   * or after dimension changes. Returns the number of nodes updated.
   */
  async reEmbedAll(embedder: { embedBatch: (texts: string[]) => Promise<number[][]> }, batchSize = 32): Promise<{ updated: number; failed: number }> {
    let offset = 0;
    let updated = 0;
    let failed = 0;
    while (true) {
      const { rows } = await this.pool.query<{ id: string; content: string }>(
        `SELECT id, content FROM memory_nodes WHERE status = 'active' AND embedding IS NOT NULL ORDER BY id LIMIT $1 OFFSET $2`,
        [batchSize, offset],
      );
      if (rows.length === 0) break;
      offset += rows.length;
      const texts = rows.map((r) => r.content);
      try {
        const embeddings = await embedder.embedBatch(texts);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const embedding = embeddings[i];
          if (!row || !embedding) continue;
          await this.pool.query(
            `UPDATE memory_nodes SET embedding = $1::vector, embedding_halfvec = $2::halfvec WHERE id = $3`,
            [`[${embedding.join(',')}]`, toHalfvecLiteral(embedding), row.id],
          );
          updated++;
        }
      } catch (e) {
        getLogger().warn('MEMORY_FABRIC_RE_EMBED', `Batch re-embed failed: ${e instanceof Error ? e.message : e}`);
        failed += rows.length;
      }
    }
    return { updated, failed };
  }

  /** Create the system-init confirmation node if it does not already exist. */
  async seedSystemInitNode(): Promise<{ created: boolean; nodeId?: string }> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM memory_nodes WHERE category = 'system' AND tag = 'system_init' LIMIT 1`,
    );
    if (rows.length > 0 && rows[0]) {
      return { created: false, nodeId: rows[0].id };
    }
    const node = await this.createNode({
      label: 'System Initialized',
      category: 'system',
      content: 'Agent-X neural fabric initialized. PostgreSQL storage provisioned and schema migrated.',
      tag: 'system_init',
      confidence: 1,
    });
    return { created: true, nodeId: node.id };
  }

  /** Skip duplicate chat-turn embeddings (same session + user turn label). */
  async hasChatMemoryTurn(sourceSessionId: string, label: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM memory_nodes
       WHERE tag = 'chat_memory'
         AND provenance->>'sourceSessionId' = $1
         AND label = $2
       LIMIT 1`,
      [sourceSessionId, label],
    );
    return rows.length > 0;
  }

  async createNode(input: MemoryNodeInput): Promise<MemoryNode> {
    const redacted = await this.piiRedactor.redact(input.content);
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
    const { rows } = await this.pool.query<MemoryNode>(
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
    await this.fireNeuron(nodeId);
    const node = await this.getNode(nodeId);
    if (!node) throw new Error('Failed to retrieve newly created memory node');
    return node;
  }

  async bindEdge(input: MemoryEdgeInput): Promise<MemoryEdge> {
    const { rows } = await this.pool.query<MemoryEdge>(
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

  async fireNeuron(nodeId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO neuron_activity (node_id, last_accessed_at, access_count)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (node_id)
       DO UPDATE SET last_accessed_at = NOW(), access_count = neuron_activity.access_count + 1`,
      [nodeId],
    );
  }

  /**
   * Find nodes by session ID and category. Used to check if a session hub
   * already exists before creating a duplicate (survives server restarts).
   */
  async findNodesBySessionAndCategory(sessionId: string, category: MemoryNodeCategory): Promise<MemoryNode[]> {
    const { rows } = await this.pool.query<MemoryNode>(
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

  async getNode(id: string): Promise<MemoryNode | null> {
    const { rows } = await this.pool.query<MemoryNode>(
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
    await this.fireNeuron(id);
    return node;
  }

  async vectorSearch(embedding: number[], options: { limit?: number; category?: MemoryNodeCategory; agentId?: string; tag?: string; sessionId?: string | null } = {}): Promise<MemoryNode[]> {
    const limit = options.limit ?? 10;
    const useHalfvec = await this.isHalfvecAvailable();
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

    const { rows } = await this.pool.query<MemoryNode>(
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
      await this.fireNeuron(row.id);
    }
    return rows;
  }

  /**
   * Weight-prioritized vector retrieval (§4). Combines pgvector similarity with
   * the aggregate synaptic weight of each node's connected edges.
   */
  async searchWeighted(
    embedding: number[],
    options: { limit?: number; category?: MemoryNodeCategory; agentId?: string } = {},
  ): Promise<Array<MemoryNode & { score: number; edgeWeight: number }>> {
    const limit = options.limit ?? 10;
    const useHalfvec = await this.isHalfvecAvailable();
    const vectorLiteral = `[${embedding.join(',')}]`;
    const halfvecLiteral = toHalfvecLiteral(embedding);
    const embeddingColumn = useHalfvec ? 'embedding_halfvec' : 'embedding';
    const vectorCast = useHalfvec ? 'halfvec' : 'vector';
    const vectorValue = useHalfvec ? halfvecLiteral : vectorLiteral;

    const { rows } = await this.pool.query<MemoryNode & { score: number; edgeWeight: number }>(
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
      await this.fireNeuron(row.id);
    }
    return rows;
  }

  async graphWalk(options: GraphWalkOptions): Promise<GraphWalkResult> {
    const maxDepth = options.maxDepth ?? 3;
    const maxFanOut = options.maxFanOut ?? 10;
    const minWeight = options.minWeight ?? 0.1;
    const relationshipTypes = options.relationshipTypes ?? [];

    // Try Apache AGE first; fall back to recursive CTE if AGE is unavailable.
    try {
      await this.pool.query('SET search_path = ag_catalog, public');
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
      const { rows } = await this.pool.query<{
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

    const { rows } = await this.pool.query<{
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
  async runGraphWalkParityTest(
    options: GraphWalkOptions,
  ): Promise<{ ageAvailable: boolean; ageResult: GraphWalkResult; cteResult: GraphWalkResult; nodeDiff: string[]; edgeDiff: string[]; passed: boolean }> {
    const runner = new MemoryMigrationRunner(this.pool);
    const { available: ageAvailable } = await runner.detectAge();
    let ageResult: GraphWalkResult = { nodeIds: [], edges: [] };
    if (ageAvailable) {
      try {
        ageResult = await this.graphWalkAge(options);
      } catch (e) {
        getLogger().warn('MEMORY_PARITY_TEST', `AGE path failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const cteResult = await this.graphWalkCte(options);

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

  private async graphWalkAge(options: GraphWalkOptions): Promise<GraphWalkResult> {
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
    await this.pool.query('SET search_path = ag_catalog, public');
    const { rows } = await this.pool.query<{ source_node_id: string; target_node_id: string; relationship_type: string; weight: number }>(cypher);
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

  private async graphWalkCte(options: GraphWalkOptions): Promise<GraphWalkResult> {
    const maxDepth = options.maxDepth ?? 3;
    const maxFanOut = options.maxFanOut ?? 10;
    const minWeight = options.minWeight ?? 0.1;
    const relationshipTypes = options.relationshipTypes ?? [];
    const { rows } = await this.pool.query<{
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

  async assembleContext(
    sessionId: string,
    embedding: number[],
    options: { agentId?: string; episodicLimit?: number; semanticLimit?: number; graphDepth?: number } = {},
  ): Promise<ContextAssemblyResult> {
    const episodicLimit = options.episodicLimit ?? 5;
    const semanticLimit = options.semanticLimit ?? 10;
    const graphDepth = options.graphDepth ?? 3;

    // Tier 1: short-term episodic memory of the active session.
    const { rows: episodic } = await this.pool.query<MemoryNode>(
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
    const { rows: semantic } = await this.pool.query<MemoryNode>(
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
      ? await this.graphWalk({ startNodeIds, maxDepth: graphDepth })
      : { nodeIds: [], edges: [] };

    const graphNodeIds = graphResult.nodeIds.filter((id) => !startNodeIds.includes(id));
    const graph: MemoryNode[] = [];
    if (graphNodeIds.length) {
      const { rows } = await this.pool.query<MemoryNode>(
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

  async createSource(name: string, kind: string, colorHex: string): Promise<MemorySource> {
    const { rows } = await this.pool.query<MemorySource>(
      `INSERT INTO memory_sources (name, kind, color_hex)
       VALUES ($1, $2, $3)
       RETURNING id, name, kind, color_hex AS "colorHex", created_at AS "createdAt"`,
      [name, kind, colorHex],
    );
    if (!rows[0]) throw new Error('Failed to create memory source');
    return rows[0];
  }

  async getSources(): Promise<MemorySource[]> {
    const { rows } = await this.pool.query<MemorySource>(
      `SELECT id, name, kind, color_hex AS "colorHex", created_at AS "createdAt",
              file_path AS "filePath", file_size AS "fileSize", file_mime AS "fileMime"
       FROM memory_sources
       ORDER BY created_at DESC`,
    );
    return rows;
  }

  /** Update the file_path / file_size / file_mime on an existing source. */
  async setSourceFilePath(sourceId: string, filePath: string, fileSize?: number, fileMime?: string): Promise<void> {
    await this.pool.query(
      `UPDATE memory_sources SET file_path = $1, file_size = $2, file_mime = $3 WHERE id = $4`,
      [filePath, fileSize ?? null, fileMime ?? null, sourceId],
    );
  }

  /** Get all nodes belonging to a specific source, with pagination. */
  async getNodesBySource(sourceId: string, options: { limit?: number; offset?: number; category?: MemoryNodeCategory } = {}): Promise<{ nodes: MemoryNode[]; total: number }> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const categoryFilter = options.category ? `AND category = '${options.category}'` : '';
    const { rows: nodes } = await this.pool.query<MemoryNode>(
      `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
              n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
              n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
              COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
       FROM memory_nodes n
       LEFT JOIN neuron_activity a ON a.node_id = n.id
       WHERE n.source_id = $1 AND n.status = 'active' ${categoryFilter}
       ORDER BY n.created_at ASC
       LIMIT $2 OFFSET $3`,
      [sourceId, limit, offset],
    );
    const { rows: countRows } = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM memory_nodes WHERE source_id = $1 AND status = 'active' ${categoryFilter}`,
      [sourceId],
    );
    return { nodes, total: countRows[0]?.count ?? 0 };
  }

  async updateLayout(nodeId: string, x: number, y: number, layoutEpoch: number): Promise<void> {
    await this.pool.query(
      `UPDATE memory_nodes SET x = $1, y = $2, layout_epoch = $3, updated_at = NOW() WHERE id = $4`,
      [x, y, layoutEpoch, nodeId],
    );
  }

  async findDuplicate(
    embedding: number[],
    threshold = 0.95,
    category?: MemoryNodeCategory,
  ): Promise<MemoryNode | null> {
    const { rows } = await this.pool.query<MemoryNode>(
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

  /**
   * Graph walk using Apache AGE when available, otherwise a recursive CTE.
   * Returns reachable nodes and the traversed edges.
   */
  async walkGraph(options: GraphWalkOptions): Promise<GraphWalkResult> {
    const startIds = options.startNodeIds;
    if (startIds.length === 0) return { nodeIds: [], edges: [] };
    const maxDepth = options.maxDepth ?? 3;
    const maxFanOut = options.maxFanOut ?? 50;
    const minWeight = options.minWeight ?? 0;
    const relTypes = options.relationshipTypes?.length ? options.relationshipTypes : undefined;
    const relFilter = relTypes ? `AND relationship_type IN (${relTypes.map((t) => `'${t}'`).join(',')})` : '';

    try {
      await this.pool.query('SET search_path = ag_catalog, public');
      const idsParam = startIds.map((id) => `'${id}'`).join(',');
      const cypher = `
        SELECT * FROM ag_catalog.cypher('memory_graph', $$
          MATCH p = (n)-[*1..${maxDepth}]->(m)
          WHERE id(n) IN [${idsParam}]
          RETURN DISTINCT id(n) AS source_id, id(m) AS target_id, 'REACHABLE' AS relationship_type, 1.0 AS weight
          LIMIT ${maxFanOut}
        $$) AS (source_id agtype, target_id agtype, relationship_type agtype, weight agtype)
      `;
      const { rows } = await this.pool.query<{ source_id: string; target_id: string; relationship_type: string; weight: number }>(cypher);
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
    const { rows } = await this.pool.query<{ id: string; sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number }>(
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

  async getNodesInViewport(
    xMin: number,
    yMin: number,
    xMax: number,
    yMax: number,
    options: { category?: MemoryNodeCategory; limit?: number } = {},
  ): Promise<MemoryNode[]> {
    const { rows } = await this.pool.query<MemoryNode>(
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

  async getGraphSnapshot(options: { limit?: number; category?: MemoryNodeCategory; tag?: string; isBenchmark?: boolean; sourceId?: string } = {}): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[] }> {
    const filters: string[] = ["n.status = 'active'"];
    if (options.category) filters.push(`n.category = '${options.category}'`);
    if (options.tag) filters.push(`n.tag = '${options.tag}'`);
    if (options.isBenchmark != null) filters.push(`n.is_benchmark = ${options.isBenchmark}`);
    if (options.sourceId) filters.push(`n.source_id = '${options.sourceId}'`);
    const where = filters.join(' AND ');
    const { rows: nodes } = await this.pool.query<MemoryNode>(
      `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
              n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
              n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
              COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
       FROM memory_nodes n
       LEFT JOIN neuron_activity a ON a.node_id = n.id
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT $1`,
      [options.limit ?? 1000],
    );
    const nodeIds = nodes.map((n) => n.id);
    const { rows: edges } = await this.pool.query<MemoryEdge>(
      `SELECT id, source_node_id AS "sourceNodeId", target_node_id AS "targetNodeId",
              relationship_type AS "relationshipType", weight, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM memory_edges
       WHERE source_node_id = ANY($1::uuid[]) AND target_node_id = ANY($1::uuid[])
       ORDER BY weight DESC`,
      [nodeIds],
    );
    return { nodes, edges };
  }

  /**
   * Server-side Louvain community detection + ForceAtlas2 layout.
   * Updates node x/y coordinates and bumps the layout epoch.
   * Returns the new epoch and the number of nodes laid out.
   */
  async getLayoutEpoch(): Promise<number> {
    const { rows } = await this.pool.query<{ maxEpoch: number }>(
      `SELECT COALESCE(MAX(layout_epoch), 0) AS "maxEpoch" FROM memory_nodes`,
    );
    return rows[0]?.maxEpoch ?? 0;
  }

  async computeLouvainLayout(): Promise<{ epoch: number; count: number; communities: number }> {
    const { rows } = await this.pool.query<{ maxEpoch: number }>(
      `SELECT COALESCE(MAX(layout_epoch), 0) + 1 AS "maxEpoch" FROM memory_nodes`,
    );
    const epoch = rows[0]?.maxEpoch ?? 1;

    const { nodes, edges } = await this.getGraphSnapshot({ limit: 5000 });
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

    const client = await this.pool.connect();
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
  async getCommunities(): Promise<{ communityId: string; memberCount: number }[]> {
    const { rows } = await this.pool.query<{ communityId: string; memberCount: number }>(
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
  async getCommunityMembers(communityId: string, limit = 100): Promise<MemoryNode[]> {
    const { rows } = await this.pool.query<MemoryNode>(
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
  async searchCommunitySummaries(embedding: number[], limit = 3): Promise<MemoryNode[]> {
    const { rows } = await this.pool.query<MemoryNode>(
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
  async getNodesInCommunities(communityIds: string[], limit = 50): Promise<MemoryNode[]> {
    if (communityIds.length === 0) return [];
    const { rows } = await this.pool.query<MemoryNode>(
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

  async getViewport(
    bounds: { xmin: number; xmax: number; ymin: number; ymax: number },
    options: { zoom?: number; category?: MemoryNodeCategory; limit?: number } = {},
  ): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[]; epoch: number; band: 'A' | 'B' | 'C' }> {
    const { xmin, xmax, ymin, ymax } = bounds;
    const zoom = options.zoom ?? 1;
    const limit = options.limit ?? 2000;
    const density = await this.getNodeCount();
    let band: 'A' | 'B' | 'C' = 'A';
    if (zoom < 0.3 && density > 1000) band = 'C';
    else if (zoom < 0.7 && density > 500) band = 'B';

    const { rows: nodes } = await this.pool.query<MemoryNode>(
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
    const { rows: edges } = await this.pool.query<MemoryEdge>(
      `SELECT id, source_node_id AS "sourceNodeId", target_node_id AS "targetNodeId", relationship_type AS "relationshipType", weight, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM memory_edges
       WHERE source_node_id = ANY($1::uuid[]) AND target_node_id = ANY($1::uuid[])
       LIMIT $2`,
      [Array.from(nodeIds), limit * 2],
    );

    const epoch = await this.getLayoutEpoch();
    return { nodes, edges, epoch, band };
  }

  private async getNodeCount(): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM memory_nodes WHERE status = 'active'`
    );
    return rows[0]?.count ?? 0;
  }

  async stageWebPayload(url: string, domain: string, kind: string, rawPayload: unknown, sourceId?: string, ttlDays = 7): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO web_staging (url, domain, kind, raw_payload, status, source_id, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW() + $6::interval)
       ON CONFLICT (url, kind) DO UPDATE SET raw_payload = EXCLUDED.raw_payload, status = 'pending', updated_at = NOW(), expires_at = NOW() + $6::interval
       RETURNING id`,
      [url, domain, kind, JSON.stringify(rawPayload), sourceId ?? null, `${ttlDays} days`],
    );
    if (!rows[0]) throw new Error('Failed to stage web payload');
    return rows[0].id;
  }

  async getPendingWebStaging(limit = 10): Promise<Array<{ id: string; url: string; domain: string; kind: string; rawPayload: unknown }>> {
    const { rows } = await this.pool.query(
      `SELECT id, url, domain, kind, raw_payload AS "rawPayload"
       FROM web_staging
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async markWebStagingDistilled(id: string, distilledContent: string): Promise<void> {
    await this.pool.query(
      `UPDATE web_staging SET distilled_content = $1, status = 'distilled', updated_at = NOW() WHERE id = $2`,
      [distilledContent, id],
    );
  }

  async markWebStagingDone(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE web_staging SET status = 'done', updated_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async cleanupExpiredWebStaging(): Promise<{ deleted: number }> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM web_staging WHERE expires_at IS NOT NULL AND expires_at < NOW()`
    );
    return { deleted: rowCount ?? 0 };
  }

  async wipeBenchmark(): Promise<{ deletedNodes: number; deletedEdges: number }> {
    const client = await this.pool.connect();
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

  /** Remove markdown divider-only nodes (---, ***, ___) from the graph. */
  async cleanupDividerNodes(dryRun = false): Promise<{
    deletedNodes: number;
    deletedEdges: number;
    dryRun: boolean;
    deletedLabels: string[];
  }> {
    const { DividerNodeCleaner } = await import('./DividerNodeCleaner.js');
    const cleaner = new DividerNodeCleaner(this.pool);
    const result = await cleaner.cleanup({ dryRun });
    return {
      deletedNodes: result.nodesDeleted,
      deletedEdges: result.edgesDeleted,
      dryRun: result.dryRun,
      deletedLabels: result.deletedLabels,
    };
  }

  async saveScorecard(scorecard: ScorecardInput): Promise<Scorecard> {
    const { rows } = await this.pool.query<Scorecard>(
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

  async getScorecards(limit = 50): Promise<Scorecard[]> {
    const { rows } = await this.pool.query<Scorecard>(
      `SELECT * FROM benchmark_scorecards ORDER BY finished_at DESC NULLS LAST LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /**
   * Reference-counting prune: when a source is deleted, remove nodes that are
   * exclusively referenced by that source, while preserving shared nodes and
   * removing only the edges to the deleted source.
   */
  async pruneSource(sourceId: string): Promise<{ deletedNodes: number; deletedEdges: number; archivedSource: boolean }> {
    const client = await this.pool.connect();
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
}

export interface ScorecardInput {
  runId: string;
  model: string;
  provider: string;
  startedAt: Date;
  finishedAt?: Date;
  totalScore: number;
  maxScore: number;
  ragTriad?: Record<string, number>;
  testResults: Record<string, TestResult>;
  metadata?: Record<string, unknown>;
}

export interface Scorecard extends ScorecardInput {
  id: string;
}

export interface TestResult {
  score: number;
  maxScore: number;
  passed: boolean;
  latencyMs: number;
  error?: string;
}
