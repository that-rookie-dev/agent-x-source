/**
 * Hierarchical GraphRAG retriever.
 *
 * Implements the Microsoft GraphRAG retrieval pattern:
 *   1. Global pass — find relevant community summaries via vector ANN
 *   2. Local pass  — expand entity subgraph from community members
 *   3. Vector pass — pgvector ANN for direct semantic matches
 *
 * The three passes are merged and deduplicated into a single context packet
 * that the LLM can use for final synthesis.
 */
import type { MemoryFabric, MemoryNode } from './MemoryFabric.js';
import type { EmbeddingProvider } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { USER_PROFILE_TAG } from './UserChatMemoryIngester.js';

export interface GraphRagRetrievalOptions {
  /** Max community summaries to retrieve (global pass). */
  globalLimit?: number;
  /** Max nodes to expand from community members (local pass). */
  localLimit?: number;
  /** Max direct vector matches (vector pass). */
  vectorLimit?: number;
  /** Max global user-profile memories (shared across all sessions). */
  userProfileLimit?: number;
  /** Graph walk depth from community member seeds. */
  graphDepth?: number;
  /** Agent ID filter for vector pass. */
  agentId?: string;
  /** Session ID for episodic context; omit for super sessions that use global retrieval only. */
  sessionId?: string;
  /** When false, skip global community/profile passes and scope vector search to sessionId. */
  isSuperSession?: boolean;
  /** Minimum cosine similarity (0–1) for the vector pass. Results below this are filtered out. */
  minRelevance?: number;
}

export interface GraphRagResult {
  /** Community summaries from the global pass. */
  global: MemoryNode[];
  /** Community member nodes from the local pass. */
  local: MemoryNode[];
  /** Direct vector matches from the vector pass. */
  vector: MemoryNode[];
  /** Graph-expanded nodes from the local pass. */
  graph: MemoryNode[];
  /** Episodic session nodes (if sessionId provided). */
  episodic: MemoryNode[];
  /** Global user-profile memories (tag=user_profile, no session scope). */
  userProfile: MemoryNode[];
  /** All unique nodes combined, for convenience. */
  all: MemoryNode[];
  /** The assembled context as a markdown string. */
  context: string;
}

export class GraphRagRetriever {
  constructor(
    private fabric: MemoryFabric,
    private embedder: EmbeddingProvider,
  ) {}

  async retrieve(query: string, options: GraphRagRetrievalOptions = {}): Promise<GraphRagResult> {
    const globalLimit = options.globalLimit ?? 3;
    const localLimit = options.localLimit ?? 20;
    const vectorLimit = options.vectorLimit ?? 10;
    const userProfileLimit = options.userProfileLimit ?? 8;
    const graphDepth = options.graphDepth ?? 2;
    const minRelevance = options.minRelevance ?? 0;
    const isSuper = options.isSuperSession === true;

    const embedding = await this.embedder.embed(query);

    // Pass 1: Global — find relevant community summaries (super sessions only).
    const global = isSuper && globalLimit > 0
      ? await this.fabric.searchCommunitySummaries(embedding, globalLimit)
      : [];
    getLogger().info('GRAPHRAG_RETRIEVE', `Global pass: ${global.length} community summaries`);

    // Pass 2: Local — expand from community members.
    const communityIds = global
      .map((n) => (n.provenance as { communityId?: string } | undefined)?.communityId)
      .filter((id): id is string => !!id);

    let local: MemoryNode[] = [];
    let graph: MemoryNode[] = [];

    if (communityIds.length > 0) {
      local = await this.fabric.getNodesInCommunities(communityIds, localLimit);
      getLogger().info('GRAPHRAG_RETRIEVE', `Local pass: ${local.length} community members`);

      // Graph walk from community member seeds.
      if (local.length > 0) {
        const startNodeIds = local.map((n) => n.id);
        const graphResult = await this.fabric.graphWalk({ startNodeIds, maxDepth: graphDepth });
        const graphNodeIds = graphResult.nodeIds.filter((id) => !startNodeIds.includes(id));
        if (graphNodeIds.length > 0) {
          // Fetch graph node details — reuse the fabric's existing pattern.
          const { rows } = await (this.fabric as any)['pool'].query(
            `SELECT n.id, n.label, n.category, n.content, n.status, n.x, n.y, n.layout_epoch AS "layoutEpoch", n.tag, n.is_benchmark AS "isBenchmark",
                    n.source_id AS "sourceId", n.session_id AS "sessionId", n.agent_id AS "agentId",
                    n.confidence, n.created_at AS "createdAt", n.updated_at AS "updatedAt"
             FROM memory_nodes n
             WHERE n.id = ANY($1::uuid[]) AND n.status = 'active'`,
            [graphNodeIds],
          );
          graph = rows;
          getLogger().info('GRAPHRAG_RETRIEVE', `Graph expansion: ${graph.length} nodes`);
        }
      }
    }

    // Pass 3: Vector — direct semantic matches, filtered by minimum relevance.
    const vectorRaw = await this.fabric.vectorSearch(embedding, {
      limit: vectorLimit,
      agentId: options.agentId,
      ...(isSuper || !options.sessionId ? {} : { sessionId: options.sessionId }),
    });
    // Filter by cosine similarity: similarity = 1 - distance. The vectorSearch query
    // attaches a `distance` field to each row (not in the MemoryNode type, hence the cast).
    const vector = minRelevance > 0
      ? vectorRaw.filter((n) => {
          const distance = (n as unknown as { distance?: number }).distance;
          return distance == null || (1 - distance) >= minRelevance;
        })
      : vectorRaw;
    getLogger().info('GRAPHRAG_RETRIEVE', `Vector pass: ${vector.length} direct matches (after relevance filter, min=${minRelevance})`);

    // Pass 4: Global user-profile memories — super sessions only.
    const userProfileRaw = isSuper
      ? await this.fabric.vectorSearch(embedding, {
        limit: userProfileLimit,
        tag: USER_PROFILE_TAG,
        sessionId: null,
      })
      : [];
    const userProfile = minRelevance > 0
      ? userProfileRaw.filter((n) => {
          const distance = (n as unknown as { distance?: number }).distance;
          return distance == null || (1 - distance) >= minRelevance;
        })
      : userProfileRaw;
    getLogger().info('GRAPHRAG_RETRIEVE', `User profile pass: ${userProfile.length} global memories`);

    // Episodic: session-scoped recent memory.
    let episodic: MemoryNode[] = [];
    if (options.sessionId) {
      const assembled = await this.fabric.assembleContext(options.sessionId, embedding, {
        agentId: options.agentId,
        episodicLimit: 5,
        semanticLimit: 0,
        graphDepth: 0,
      });
      episodic = assembled.episodic;
    }

    // Deduplicate all nodes.
    const seen = new Set<string>();
    const all: MemoryNode[] = [];
    for (const node of [...global, ...local, ...vector, ...graph, ...episodic, ...userProfile]) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        all.push(node);
      }
    }

    const context = this.buildContextMarkdown(global, local, vector, graph, episodic, userProfile);
    getLogger().info('GRAPHRAG_RETRIEVE', `Total unique nodes: ${all.length}`);

    return { global, local, vector, graph, episodic, userProfile, all, context };
  }

  private buildContextMarkdown(
    global: MemoryNode[],
    local: MemoryNode[],
    vector: MemoryNode[],
    graph: MemoryNode[],
    episodic: MemoryNode[],
    userProfile: MemoryNode[],
  ): string {
    const sections: string[] = [];

    if (userProfile.length > 0) {
      sections.push('## User Profile (long-term memory)');
      for (const n of userProfile) {
        sections.push(`- **${n.label}**: ${n.content.slice(0, 300)}`);
      }
    }

    if (global.length > 0) {
      sections.push('## Community Context');
      for (const n of global) {
        sections.push(`**${n.label}**: ${n.content}`);
      }
    }

    if (local.length > 0) {
      sections.push('\n## Related Entities');
      for (const n of local) {
        sections.push(`- **${n.label}**: ${n.content.slice(0, 300)}`);
      }
    }

    if (vector.length > 0) {
      sections.push('\n## Direct Matches');
      for (const n of vector) {
        sections.push(`- **${n.label}**: ${n.content.slice(0, 300)}`);
      }
    }

    if (graph.length > 0) {
      sections.push('\n## Graph Context');
      for (const n of graph) {
        sections.push(`- **${n.label}**: ${n.content.slice(0, 200)}`);
      }
    }

    if (episodic.length > 0) {
      sections.push('\n## Session Memory');
      for (const n of episodic) {
        sections.push(`- **${n.label}**: ${n.content.slice(0, 200)}`);
      }
    }

    return sections.join('\n');
  }
}
