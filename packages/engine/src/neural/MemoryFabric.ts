/**
 * Unified Neural Brain / Memory Fabric
 *
 * A single node/edge store for all Agent-X memory: knowledge, episodic sessions,
 * tools, personas, and web data. Uses PostgreSQL + pgvector for semantic search
 * and recursive CTEs for graph traversal.
 */
import { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { MemoryMigrationRunner } from './MemoryMigrationRunner.js';
import { getGlobalBrainEventStreamer } from './BrainEventStreamer.js';
import { PiiRedactor } from './PiiRedactor.js';
import { SecureVault } from './SecureVault.js';
import {
  graphWalk as graphWalkImpl,
  walkGraph as walkGraphImpl,
} from './fabric-graph-walk.js';
import {
  updateLayout as updateLayoutImpl,
  getNodesInViewport as getNodesInViewportImpl,
  getLayoutEpoch as getLayoutEpochImpl,
  computeLouvainLayout as computeLouvainLayoutImpl,
  getCommunities as getCommunitiesImpl,
  getCommunityMembers as getCommunityMembersImpl,
  searchCommunitySummaries as searchCommunitySummariesImpl,
  getNodesInCommunities as getNodesInCommunitiesImpl,
  getViewport as getViewportImpl,
} from './fabric-layout.js';
import {
  createNode as createNodeImpl,
  bindEdge as bindEdgeImpl,
  fireNeuron as fireNeuronImpl,
  fireNeurons as fireNeuronsImpl,
  findNodesBySessionAndCategory as findNodesBySessionAndCategoryImpl,
  getNode as getNodeImpl,
  hasChatMemoryTurn as hasChatMemoryTurnImpl,
  seedSystemInitNode as seedSystemInitNodeImpl,
} from './fabric-node-crud.js';
import type { NodeCrudContext } from './fabric-node-crud.js';
import {
  vectorSearch as vectorSearchImpl,
  lexicalSearch as lexicalSearchImpl,
  hybridSearch as hybridSearchImpl,
  searchWeighted as searchWeightedImpl,
  assembleContext as assembleContextImpl,
  findDuplicate as findDuplicateImpl,
} from './fabric-search.js';
import type { SearchContext } from './fabric-search.js';
import {
  reEmbedAll as reEmbedAllImpl,
  createSource as createSourceImpl,
  getSources as getSourcesImpl,
  setSourceFilePath as setSourceFilePathImpl,
  getNodesBySource as getNodesBySourceImpl,
  wipeMemoryForSessionScope as wipeMemoryForSessionScopeImpl,
  wipeBenchmark as wipeBenchmarkImpl,
  saveScorecard as saveScorecardImpl,
  getScorecards as getScorecardsImpl,
  pruneSource as pruneSourceImpl,
} from './fabric-persistence.js';
import type { PersistenceContext } from './fabric-persistence.js';
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
  /** Louvain community assigned by the server-side layout pass (null before first layout). */
  communityId?: string | null;
  /**
   * Provenance: character span in the source text. On write this is `[start, end]`;
   * on read from PostgreSQL the INT4RANGE column comes back as a string like `"[0,10]"`.
   * Callers reading from the DB should parse the string if a numeric tuple is needed.
   */
  charSpan?: string | [number, number];
  /** Provenance: free-form metadata from the DB (parsed JSONB object). */
  provenance?: Record<string, unknown>;
  /** Similarity distance returned by vector search. */
  distance?: number;
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

// ── Module-level singleton for tool access ──────────────────────────
let _fabricInstance: MemoryFabric | null = null;

/** Set the global MemoryFabric singleton (called once at engine startup). */
export function setMemoryFabricInstance(fabric: MemoryFabric | null): void {
  _fabricInstance = fabric;
}

/** Get the global MemoryFabric singleton (used by cortex memory tools). */
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

  getPool(): Pool {
    return this.pool;
  }

  setPiiRedactor(redactor: PiiRedactor): void {
    this.piiRedactor = redactor;
  }

  setVault(vault: SecureVault): void {
    this.vault = vault;
    this.piiRedactor = new PiiRedactor({ vault });
  }

  /** Build the NodeCrudContext used by fabric-node-crud.ts helpers. */
  private nodeCrudCtx(): NodeCrudContext {
    return {
      pool: this.pool,
      piiRedactor: this.piiRedactor,
      fireNeuron: (nodeId: string) => this.fireNeuron(nodeId),
    };
  }

  /** Build the SearchContext used by fabric-search.ts helpers. */
  private searchCtx(): SearchContext {
    return {
      pool: this.pool,
      isHalfvecAvailable: () => this.isHalfvecAvailable(),
      fireNeuron: (nodeId: string) => this.fireNeuron(nodeId),
      fireNeurons: (nodeIds: string[]) => this.fireNeurons(nodeIds),
      graphWalk: (options: GraphWalkOptions) => this.graphWalk(options),
    };
  }

  /** Build the PersistenceContext used by fabric-persistence.ts helpers. */
  private persistenceCtx(): PersistenceContext {
    return { pool: this.pool };
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

  async migrate(): Promise<{ applied: number; currentVersion: number }> {
    const runner = new MemoryMigrationRunner(this.pool);
    const { applied, currentVersion } = await runner.ensureSchema();
    return { applied, currentVersion };
  }

  /**
   * Comprehensive self-healing pass:
   * - re-run versioned migrations,
   * - verify every required table and recreate missing indexes.
   * Safe to call on every startup and periodic health pass.
   */
  async heal(onProgress?: (line: string) => void): Promise<{ schemaRepaired: boolean }> {
    const runner = new MemoryMigrationRunner(this.pool);
    const { applied, currentVersion } = await runner.ensureSchema();
    if (onProgress) {
      if (applied === 0) {
        onProgress(`Neural memory fabric verified (schema v${currentVersion}, 0 new migrations).`);
      } else {
        onProgress(`Applied ${applied} neural memory migration(s) — now at v${currentVersion}.`);
      }
    }

    const missingIndexes = await this.verifyIndexes();
    if (missingIndexes.length > 0) {
      getLogger().warn('CORTEX_FABRIC_HEAL', `Rebuilding missing indexes: ${missingIndexes.join(', ')}`);
      onProgress?.(`Rebuilding ${missingIndexes.length} missing neural memory index(es)…`);
    }
    const schemaRepaired = applied > 0 || missingIndexes.length > 0;
    return { schemaRepaired };
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
    return reEmbedAllImpl(this.persistenceCtx(), embedder, batchSize);
  }

  /** Create the system-init confirmation node if it does not already exist. */
  async seedSystemInitNode(): Promise<{ created: boolean; nodeId?: string }> {
    return seedSystemInitNodeImpl(this.nodeCrudCtx());
  }

  /** Skip duplicate chat-turn embeddings (same session + user turn label). */
  async hasChatMemoryTurn(sourceSessionId: string, label: string): Promise<boolean> {
    return hasChatMemoryTurnImpl(this.nodeCrudCtx(), sourceSessionId, label);
  }

  async createNode(input: MemoryNodeInput): Promise<MemoryNode> {
    const node = await createNodeImpl(this.nodeCrudCtx(), input);
    getGlobalBrainEventStreamer().emitNodeCreated({
      nodeId: node.id,
      label: node.label,
      category: node.category,
      x: node.x ?? null,
      y: node.y ?? null,
      sourceId: node.sourceId ?? null,
      sessionId: node.sessionId ?? null,
    });
    return node;
  }

  async bindEdge(input: MemoryEdgeInput): Promise<MemoryEdge> {
    const edge = await bindEdgeImpl(this.nodeCrudCtx(), input);
    getGlobalBrainEventStreamer().emitSynapseConnected({
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
      relationshipType: edge.relationshipType,
      weight: edge.weight,
    });
    return edge;
  }

  async fireNeuron(nodeId: string): Promise<void> {
    await fireNeuronImpl(this.nodeCrudCtx(), nodeId);
    getGlobalBrainEventStreamer().emitNeuronActivated({ nodeIds: [nodeId] });
  }

  async fireNeurons(nodeIds: string[]): Promise<void> {
    const ids = [...new Set(nodeIds.filter(Boolean))];
    if (!ids.length) return;
    await fireNeuronsImpl(this.nodeCrudCtx(), ids);
    getGlobalBrainEventStreamer().emitNeuronActivated({ nodeIds: ids });
  }

  /**
   * Find nodes by session ID and category. Used to check if a session hub
   * already exists before creating a duplicate (survives server restarts).
   */
  async findNodesBySessionAndCategory(sessionId: string, category: MemoryNodeCategory): Promise<MemoryNode[]> {
    return findNodesBySessionAndCategoryImpl(this.nodeCrudCtx(), sessionId, category);
  }

  async getNode(id: string): Promise<MemoryNode | null> {
    return getNodeImpl(this.nodeCrudCtx(), id);
  }

  async vectorSearch(embedding: number[], options: { limit?: number; category?: MemoryNodeCategory; agentId?: string; tag?: string; sessionId?: string | null; sourceId?: string } = {}): Promise<MemoryNode[]> {
    return vectorSearchImpl(this.searchCtx(), embedding, options);
  }

  async lexicalSearch(
    query: string,
    options: { limit?: number; category?: MemoryNodeCategory; agentId?: string; tag?: string; sessionId?: string | null; sourceId?: string } = {},
  ): Promise<MemoryNode[]> {
    return lexicalSearchImpl(this.searchCtx(), query, options);
  }

  async hybridSearch(
    embedding: number[],
    query: string,
    options: { limit?: number; category?: MemoryNodeCategory; agentId?: string; tag?: string; sessionId?: string | null; sourceId?: string; vectorLimit?: number; lexicalLimit?: number } = {},
  ): Promise<MemoryNode[]> {
    return hybridSearchImpl(this.searchCtx(), embedding, query, options);
  }

  /**
   * Weight-prioritized vector retrieval (§4). Combines pgvector similarity with
   * the aggregate synaptic weight of each node's connected edges.
   */
  async searchWeighted(
    embedding: number[],
    options: { limit?: number; category?: MemoryNodeCategory; agentId?: string } = {},
  ): Promise<Array<MemoryNode & { score: number; edgeWeight: number }>> {
    return searchWeightedImpl(this.searchCtx(), embedding, options);
  }

  async graphWalk(options: GraphWalkOptions): Promise<GraphWalkResult> {
    return graphWalkImpl({ pool: this.pool }, options);
  }

  async assembleContext(
    sessionId: string,
    embedding: number[],
    options: { agentId?: string; episodicLimit?: number; semanticLimit?: number; graphDepth?: number } = {},
  ): Promise<ContextAssemblyResult> {
    return assembleContextImpl(this.searchCtx(), sessionId, embedding, options);
  }

  async createSource(name: string, kind: string, colorHex: string): Promise<MemorySource> {
    return createSourceImpl(this.persistenceCtx(), name, kind, colorHex);
  }

  async getSources(): Promise<MemorySource[]> {
    return getSourcesImpl(this.persistenceCtx());
  }

  /** Update the file_path / file_size / file_mime on an existing source. */
  async setSourceFilePath(sourceId: string, filePath: string, fileSize?: number, fileMime?: string): Promise<void> {
    return setSourceFilePathImpl(this.persistenceCtx(), sourceId, filePath, fileSize, fileMime);
  }

  /** Get all nodes belonging to a specific source, with pagination. */
  async getNodesBySource(sourceId: string, options: { limit?: number; offset?: number; category?: MemoryNodeCategory } = {}): Promise<{ nodes: MemoryNode[]; total: number }> {
    return getNodesBySourceImpl(this.persistenceCtx(), sourceId, options);
  }

  async updateLayout(nodeId: string, x: number, y: number, layoutEpoch: number): Promise<void> {
    return updateLayoutImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() }, nodeId, x, y, layoutEpoch);
  }

  async findDuplicate(
    embedding: number[],
    threshold = 0.95,
    category?: MemoryNodeCategory,
  ): Promise<MemoryNode | null> {
    return findDuplicateImpl(this.searchCtx(), embedding, threshold, category);
  }

  /** Graph walk over memory_edges using a recursive SQL CTE. */
  async walkGraph(options: GraphWalkOptions): Promise<GraphWalkResult> {
    return walkGraphImpl({ pool: this.pool }, options);
  }

  async getNodesInViewport(
    xMin: number,
    yMin: number,
    xMax: number,
    yMax: number,
    options: { category?: MemoryNodeCategory; limit?: number } = {},
  ): Promise<MemoryNode[]> {
    return getNodesInViewportImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() }, xMin, yMin, xMax, yMax, options);
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
              n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId", n.community_id AS "communityId",
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

  /** Hydrate a set of node ids into full nodes (with activity + community). */
  async getNodesByIds(ids: string[]): Promise<MemoryNode[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query<MemoryNode>(
      `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
              n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId", n.community_id AS "communityId",
              n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt",
              COALESCE(a.access_count, 0)::integer AS "accessCount", a.last_accessed_at AS "lastAccessedAt"
       FROM memory_nodes n
       LEFT JOIN neuron_activity a ON a.node_id = n.id
       WHERE n.id = ANY($1::uuid[]) AND n.status = 'active'`,
      [ids],
    );
    return rows;
  }

  /**
   * Aggregate stats for the Neural Cortex visualization HUD:
   * counts, per-category breakdown, layout epoch, and 30-day growth series.
   */
  async getCortexMeta(): Promise<{
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
    layoutEpoch: number;
    categories: Array<{ category: string; count: number }>;
    growth: Array<{ day: string; count: number }>;
    lastNodeAt: string | null;
  }> {
    // Sequential queries — embedded PostgreSQL runs with max_connections=10,
    // so a parallel fan-out here can exhaust the server's connection budget.
    const { rows: statsRows } = await this.pool.query<{
      nodeCount: number; edgeCount: number; communityCount: number; lastNodeAt: string | null;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM memory_nodes WHERE status = 'active') AS "nodeCount",
         (SELECT COUNT(*)::int FROM memory_edges) AS "edgeCount",
         (SELECT COUNT(DISTINCT community_id)::int FROM memory_nodes WHERE community_id IS NOT NULL AND status = 'active') AS "communityCount",
         (SELECT MAX(created_at)::text FROM memory_nodes WHERE status = 'active') AS "lastNodeAt"`,
    );
    const { rows: categories } = await this.pool.query<{ category: string; count: number }>(
      `SELECT category, COUNT(*)::int AS count FROM memory_nodes WHERE status = 'active' GROUP BY category ORDER BY count DESC`,
    );
    const { rows: growth } = await this.pool.query<{ day: string; count: number }>(
      `SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
       FROM memory_nodes
       WHERE status = 'active' AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY created_at::date
       ORDER BY created_at::date`,
    );
    const epoch = await this.getLayoutEpoch();
    return {
      nodeCount: statsRows[0]?.nodeCount ?? 0,
      edgeCount: statsRows[0]?.edgeCount ?? 0,
      communityCount: statsRows[0]?.communityCount ?? 0,
      layoutEpoch: epoch,
      categories,
      growth,
      lastNodeAt: statsRows[0]?.lastNodeAt ?? null,
    };
  }

  /**
   * Server-side Louvain community detection + ForceAtlas2 layout.
   * Updates node x/y coordinates and bumps the layout epoch.
   * Returns the new epoch and the number of nodes laid out.
   */
  async getLayoutEpoch(): Promise<number> {
    return getLayoutEpochImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() });
  }

  async computeLouvainLayout(): Promise<{ epoch: number; count: number; communities: number }> {
    return computeLouvainLayoutImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() });
  }

  /**
   * Get all distinct community IDs with their member counts.
   * Used by community summarization batch jobs to decide which communities need summarization.
   */
  async getCommunities(): Promise<{ communityId: string; memberCount: number }[]> {
    return getCommunitiesImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() });
  }

  /**
   * Get all nodes in a specific community (for summarization).
   */
  async getCommunityMembers(communityId: string, limit = 100): Promise<MemoryNode[]> {
    return getCommunityMembersImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() }, communityId, limit);
  }

  /**
   * Find community summary nodes whose embeddings are closest to the query.
   * Used as the "global pass" in GraphRAG hierarchical retrieval.
   */
  async searchCommunitySummaries(embedding: number[], limit = 3): Promise<MemoryNode[]> {
    return searchCommunitySummariesImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() }, embedding, limit);
  }

  /**
   * Get all nodes in the communities identified by the given community IDs.
   * Used to expand from community summaries to their member nodes.
   */
  async getNodesInCommunities(communityIds: string[], limit = 50): Promise<MemoryNode[]> {
    return getNodesInCommunitiesImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() }, communityIds, limit);
  }

  async getViewport(
    bounds: { xmin: number; xmax: number; ymin: number; ymax: number },
    options: { zoom?: number; category?: MemoryNodeCategory; limit?: number } = {},
  ): Promise<{ nodes: MemoryNode[]; edges: MemoryEdge[]; epoch: number; band: 'A' | 'B' | 'C' }> {
    return getViewportImpl({ pool: this.pool, getGraphSnapshot: (o) => this.getGraphSnapshot(o), getNodeCount: () => this.getNodeCount() }, bounds, options);
  }

  private async getNodeCount(): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM memory_nodes WHERE status = 'active'`
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Remove memory fabric nodes (and connected edges) for a session scope.
   * sessionId null = super-session global bucket (session_id IS NULL).
   */
  async wipeMemoryForSessionScope(sessionId: string | null): Promise<{ deletedNodes: number; deletedEdges: number }> {
    return wipeMemoryForSessionScopeImpl(this.persistenceCtx(), sessionId);
  }

  async wipeBenchmark(): Promise<{ deletedNodes: number; deletedEdges: number }> {
    return wipeBenchmarkImpl(this.persistenceCtx());
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
    return saveScorecardImpl(this.persistenceCtx(), scorecard);
  }

  async getScorecards(limit = 50): Promise<Scorecard[]> {
    return getScorecardsImpl(this.persistenceCtx(), limit);
  }

  /**
   * Reference-counting prune: when a source is deleted, remove nodes that are
   * exclusively referenced by that source, while preserving shared nodes and
   * removing only the edges to the deleted source.
   */
  async pruneSource(sourceId: string): Promise<{ deletedNodes: number; deletedEdges: number; archivedSource: boolean }> {
    return pruneSourceImpl(this.persistenceCtx(), sourceId);
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
